#!/usr/bin/env node
/**
 * Patch the generated Android project so "Open with Paperling" actually opens
 * the picked file.
 *
 * Why this is needed: out of the box the generated MainActivity has no
 * ACTION_VIEW handling — the app launches and the intent's file URI is
 * dropped on the floor (reported from on-device testing). Two extra problems
 * make the naive fix wrong:
 *   1. File managers hand out `content://` URIs, which std::fs (our Rust file
 *      commands) cannot read.
 *   2. `gen/android` is CI-generated and never committed, so the fix must be
 *      a repeatable patch, like patch-android-release-signing.mjs.
 *
 * What this script does:
 *   A. Rewrites MainActivity.kt (package name preserved from the existing
 *      file) so ACTION_VIEW data is copied from the ContentResolver into an
 *      `inbox/` folder inside the app's private storage, then handed to the
 *      webview via `window.__paperlingOpenFile(path, name)` — the real file
 *      path, so every downstream flow (read, save, recents, autosave) works
 *      unchanged. Retries until the webview is up (cold start races it).
 *   B. Inserts ACTION_VIEW intent-filters (text/markdown, text/plain,
 *      application/octet-stream) into the launcher activity so the app is a
 *      proper "Open with" candidate and "Always" sticks.
 *
 * Idempotent (marker-guarded); fails loudly with the offending file content
 * if the anchors are missing.
 *
 * Usage: node patch-android-file-open.mjs <path-to-gen/android>
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const MARKER = "PAPERLING-FILE-OPEN";

const genDir = process.argv[2];
if (!genDir) {
    console.error("Usage: node patch-android-file-open.mjs <path-to-gen/android>");
    process.exit(1);
}
if (!existsSync(genDir)) {
    console.error(`::error::Generated Android project not found at ${genDir} — run \`tauri android init\` first.`);
    process.exit(1);
}

const walk = (dir) =>
    readdirSync(dir).flatMap((entry) => {
        const full = join(dir, entry);
        return statSync(full).isDirectory() ? walk(full) : [full];
    });

// ---------- A. MainActivity.kt ----------
// Anchor-based edits of the CLI template (NOT a wholesale rewrite): the
// template references TauriActivity without an import because the class is
// codegen'd into the app's own package at init time, and calls
// enableEdgeToEdge() — both must survive untouched.
//
// The template (tauri-cli 2.x) this script understands:
//   package <pkg>
//   import android.os.Bundle
//   import androidx.activity.enableEdgeToEdge
//   class MainActivity : TauriActivity() {
//     override fun onCreate(savedInstanceState: Bundle?) {
//       enableEdgeToEdge()
//       super.onCreate(savedInstanceState)
//     }
//   }
const mainActivityPath = walk(genDir).find((f) => f.endsWith("MainActivity.kt"));
if (!mainActivityPath) {
    console.error("::error::MainActivity.kt not found under gen/android — template layout changed?");
    process.exit(1);
}
const existing = readFileSync(mainActivityPath, "utf8");
if (existing.includes(MARKER)) {
    console.log(`${relative(process.cwd(), mainActivityPath)} already patched — skipping.`);
} else {
    let kt = existing;

    const fail = (msg) => {
        console.error(`::error::${msg} — the MainActivity template changed; update this script.`);
        console.error(`----- ${mainActivityPath} -----`);
        console.error(existing);
        process.exit(1);
    };

    // 1. Extra imports, added right after the Bundle import (always present).
    if (!/^import android\.os\.Bundle$/m.test(kt)) fail("Anchor `import android.os.Bundle` not found");
    kt = kt.replace(
        /^import android\.os\.Bundle$/m,
        [
            "import android.content.Intent",
            "import android.net.Uri",
            "import android.os.Bundle",
            "import android.os.Handler",
            "import android.os.Looper",
            "import android.provider.OpenableColumns",
            "import android.view.View",
            "import android.view.ViewGroup",
            "import android.webkit.WebView",
            "import java.io.File",
            "import org.json.JSONObject",
        ].join("\n"),
    );

    // 2. onCreate: forward the intent after the template's own setup.
    const onCreateAnchor = /override fun onCreate\(savedInstanceState: Bundle\?\) \{([\s\S]*?)\n([ \t]*)\}/;
    const onCreateMatch = kt.match(onCreateAnchor);
    if (!onCreateMatch) fail("Anchor `override fun onCreate(...)` not found");
    kt = kt.replace(onCreateAnchor, (_full, body, indent) =>
        `override fun onCreate(savedInstanceState: Bundle?) {${body}\n${indent}  forwardOpenIntent(intent)\n${indent}}`,
    );

    // 3. New methods, inserted INSIDE the class: drop the file's final `}`
    //    (the class closer), append the methods, then re-close the class.
    const trimmed = kt.replace(/\s+$/, "");
    if (!trimmed.endsWith("}")) fail("File does not end with the class closing brace");
    const classBody = trimmed.slice(0, -1);
    const methods = `

    // ${MARKER}: handle "Open with Paperling" (ACTION_VIEW). The picked file
    // is copied into the app's private inbox/ folder (std::fs cannot read
    // content:// URIs) and the real path is handed to the webview, which
    // opens it through the normal file flow.

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        forwardOpenIntent(intent)
    }

    private fun forwardOpenIntent(intent: Intent?) {
        val uri = intent?.data ?: return
        if (uri.toString().isBlank()) return
        Thread {
            val resolved = copyToInbox(uri)
            if (resolved != null) {
                mainHandler.post { deliverToWebView(resolved.first, resolved.second) }
            }
        }.start()
    }

    // Copy the picked document into files/inbox/ under a collision-free name
    // (never overwrites: your earlier edits to an inbox copy are safe).
    private fun copyToInbox(uri: Uri): Pair<String, String>? {
        return try {
            var name = uri.lastPathSegment ?: "opened.md"
            try {
                contentResolver.query(uri, null, null, null, null)?.use { cursor ->
                    if (cursor.moveToFirst()) {
                        val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        if (idx >= 0 && !cursor.isNull(idx)) {
                            val display = cursor.getString(idx)
                            if (!display.isNullOrBlank()) name = display
                        }
                    }
                }
            } catch (_: Exception) {
                // display name is best-effort; the path segment is fine
            }
            // Allowlist sanitize (no regex-escaping traps in generated Kotlin):
            // letters, digits, space, dot, dash, underscore, parens.
            name = name.substringAfterLast('/').filter { it.isLetterOrDigit() || it in " .-_()" }.ifBlank { "opened.md" }
            val inbox = File(filesDir, "inbox").apply { mkdirs() }
            var target = File(inbox, name)
            if (target.exists()) {
                val dot = name.lastIndexOf('.')
                val stem = if (dot > 0) name.substring(0, dot) else name
                val ext = if (dot > 0) name.substring(dot) else ""
                var k = 1
                while (target.exists()) {
                    target = File(inbox, "$stem ($k)$ext")
                    k++
                }
            }
            contentResolver.openInputStream(uri)?.use { input ->
                target.outputStream().use { output -> input.copyTo(output) }
            } ?: return null
            Pair(target.absolutePath, target.name)
        } catch (_: Exception) {
            null
        }
    }

    // Hand the copied file to the webview. The webview does not exist yet on
    // a cold start, so retry until it is up AND the bootstrap function from
    // index.html is present, then fire once.
    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

    private fun deliverToWebView(path: String, name: String) {
        var attempts = 0
        fun tryOnce() {
            attempts++
            val webview = findWebView(window.decorView)
            if (webview == null) {
                if (attempts < 40) mainHandler.postDelayed({ tryOnce() }, 500)
                return
            }
            webview.evaluateJavascript("!!window.__paperlingOpenFile") { ready ->
                if (ready == "true") {
                    val js = "window.__paperlingOpenFile(" + JSONObject.quote(path) + ", " + JSONObject.quote(name) + ")"
                    webview.evaluateJavascript(js, null)
                } else if (attempts < 40) {
                    mainHandler.postDelayed({ tryOnce() }, 500)
                }
            }
        }
        tryOnce()
    }

    private fun findWebView(view: View?): WebView? {
        if (view is WebView) return view
        if (view is ViewGroup) {
            for (i in 0 until view.childCount) {
                findWebView(view.getChildAt(i))?.let { return it }
            }
        }
        return null
    }
`;
    kt = `${classBody}${methods}}\n`;

    // 4. Verify the patch landed before writing: markers present, braces
    //    balanced, and onNewIntent sits INSIDE the class (before the final
    //    brace), not floating at file top level.
    for (const marker of ["forwardOpenIntent(intent)", "onNewIntent", "__paperlingOpenFile"]) {
        if (!kt.includes(marker)) fail(`Verification failed: '${marker}' missing after patch`);
    }
    const opens = (kt.match(/\{/g) ?? []).length;
    const closes = (kt.match(/\}/g) ?? []).length;
    if (opens !== closes) fail(`Brace imbalance after patch: {=${opens} }=${closes}`);
    if (kt.lastIndexOf("override fun onNewIntent") > kt.lastIndexOf("}")) {
        fail("onNewIntent landed outside the class body");
    }

    writeFileSync(mainActivityPath, kt);
    console.log(`Patched ${relative(process.cwd(), mainActivityPath)} with ACTION_VIEW handling.`);
}

// ---------- B. AndroidManifest.xml intent-filters ----------
const manifestPath = join(genDir, "app", "src", "main", "AndroidManifest.xml");
if (!existsSync(manifestPath)) {
    console.error(`::error::AndroidManifest.xml not found at ${manifestPath}`);
    process.exit(1);
}
const manifest = readFileSync(manifestPath, "utf8");
if (manifest.includes(MARKER)) {
    console.log(`${relative(process.cwd(), manifestPath)} already patched — skipping.`);
} else {
    const launcherIdx = manifest.indexOf("android.intent.category.LAUNCHER");
    const closeIdx = manifest.indexOf("</activity>", launcherIdx >= 0 ? launcherIdx : 0);
    if (launcherIdx < 0 || closeIdx < 0) {
        console.error("::error::Could not find the launcher <activity> in AndroidManifest.xml");
        console.error(manifest);
        process.exit(1);
    }
    const filters = `\
        <!-- ${MARKER}: register as an "Open with" target for markdown and
             plain text. Written by scripts/patch-android-file-open.mjs. -->
        <intent-filter>
            <action android:name="android.intent.action.VIEW" />
            <category android:name="android.intent.category.DEFAULT" />
            <data android:mimeType="text/markdown" />
            <data android:mimeType="text/plain" />
            <data android:mimeType="application/octet-stream" />
        </intent-filter>
    `;
    const updated = manifest.slice(0, closeIdx) + filters + manifest.slice(closeIdx);
    writeFileSync(manifestPath, updated);
    console.log(`Inserted ACTION_VIEW intent-filters into ${relative(process.cwd(), manifestPath)}.`);
}

console.log("File-open patch complete.");
