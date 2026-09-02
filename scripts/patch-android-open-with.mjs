#!/usr/bin/env node
/**
 * Patch the Tauri-generated Android project for three things the template lacks:
 *
 * 1. "Open with" / "Always" for .md files. Android delivers these as ACTION_VIEW
 *    intents carrying a content:// URI — there is no command line on Android, so
 *    the desktop CLI-arg path never sees them. This patch adds an intent-filter
 *    (text/markdown, text/x-markdown, text/plain) to the manifest and intent
 *    capture in MainActivity: the file is copied from the content resolver into
 *    the app's cache dir and a small incoming.json marker is written. The Rust
 *    command `get_incoming_file` hands that to the frontend (take-once), which
 *    opens it like any other note.
 *
 * 2. System-bar insets. The template calls enableEdgeToEdge(), so the webview
 *    draws UNDER the status and navigation bars, and Android WebView reports
 *    env(safe-area-inset-*) = 0 — the app bar controls ended up cramped against
 *    the status bar. The patch applies the real status/cutout/nav insets as
 *    PADDING on the window's content view, so the webview viewport starts below
 *    the status bar and above the gesture bar on every Android version
 *    (including 15+/16 where edge-to-edge cannot be opted out of).
 *
 * 3. System back (gesture / button) that behaves like an app. The template's
 *    default finishes the activity outright, so back with Settings open killed
 *    the whole editor. The patch routes back presses to the web app: the IME
 *    hides first, then the frontend's window.__paperlingBack() closes its
 *    topmost surface (menu, palette, settings, find bar, panels...) and reports
 *    `true`; only `false` (nothing left to close) finishes the activity.
 *
 * 4. Launcher icon safe zone. `tauri icon` ships a foreground that fills the
 *    whole 108dp adaptive-icon canvas, so launcher masks (a ~72dp circle or
 *    squircle) clipped the logo's outer strokes. The patch routes the
 *    foreground through an inset drawable that scales it into the safe zone.
 *
 * Idempotent via markers; fails loudly (dumping the target file) if the
 * template anchors moved — same contract as patch-android-release-signing.mjs.
 *
 * Usage: node patch-android-open-with.mjs <gen/android>
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_MARKER = "PAPERLING-OPEN-WITH";
const ACTIVITY_MARKER = "PAPERLING-INIntent";

const INTENT_FILTER_XML = `\
            <!-- ${MANIFEST_MARKER}: appear in "Open with" for markdown and text files -->
            <intent-filter>
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <data android:mimeType="text/markdown" />
                <data android:mimeType="text/x-markdown" />
                <data android:mimeType="text/plain" />
            </intent-filter>
`;

const ACTIVITY_IMPORTS = `\
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.view.View
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import java.io.File
import org.json.JSONObject
`;

const ACTIVITY_BODY = `\
  // ${ACTIVITY_MARKER}: system-bar insets, "open with" handling, the app-style
  // back handler and the system document picker (CI patch).
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    applySystemBarInsets()
    setupBackHandler()
    attachDocumentBridge()
    handleOpenIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    handleOpenIntent(intent)
  }

  // Edge-to-edge is on (and forced on Android 15+), and the WebView reports
  // env(safe-area-inset-*) as 0 — so pad the window's content view with the
  // real status/cutout/nav insets. The webview viewport then starts below the
  // status bar and above the gesture bar; the web app needs no inset CSS.
  private fun applySystemBarInsets() {
    val content = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(content) { v, insets ->
      val bars = insets.getInsets(
        WindowInsetsCompat.Type.statusBars()
          or WindowInsetsCompat.Type.displayCutout()
          or WindowInsetsCompat.Type.navigationBars()
      )
      v.setPadding(bars.left, bars.top, bars.right, bars.bottom)
      WindowInsetsCompat.CONSUMED
    }
  }

  // System back, app-style. The default (finish the activity) made back with
  // Settings open close the whole editor. Order of precedence, matching how
  // Android apps behave:
  //   1. keyboard up  -> hide the IME (standard behaviour, never the app)
  //   2. web app says it closed its topmost surface (__paperlingBack() === true)
  //   3. otherwise the default: finish the activity (leave the app)
  private fun setupBackHandler() {
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        val decor = window.decorView
        val insets = ViewCompat.getRootWindowInsets(decor)
        if (insets != null && insets.isVisible(WindowInsetsCompat.Type.ime())) {
          WindowCompat.getInsetsController(window, decor).hide(WindowInsetsCompat.Type.ime())
          return
        }
        val web = findWebView(decor)
        if (web == null) {
          finish()
          return
        }
        web.evaluateJavascript(
          "(function(){try{if(window.__paperlingBack&&window.__paperlingBack()===true){return '1'}}catch(e){}return '0'})()"
        ) { result ->
          if (result?.trim('"') != "1") {
            finish()
          }
        }
      }
    })
  }

  // The Tauri webview is buried in the view hierarchy; walk it depth-first.
  private fun findWebView(v: View?): WebView? {
    if (v is WebView) return v
    if (v is android.view.ViewGroup) {
      for (i in 0 until v.childCount) {
        findWebView(v.getChildAt(i))?.let { return it }
      }
    }
    return null
  }

  // ==== System document picker (SAF) ====
  //
  // The in-app browser only reaches folders the Rust file commands can read —
  // on Android that's the app-private notes area, so "go up" dead-ends in app
  // data. Opening a note from anywhere on the phone needs ACTION_OPEN_DOCUMENT:
  // JS calls PaperlingAndroid.openDocument(), the picked content:// file is
  // copied into the app cache (std::fs cannot read content:// URIs), and the
  // real cache path goes to the webview through window.__paperlingOpenFile —
  // the same bridge the "Open with" intent flow uses.
  private var documentBridgeAttached = false
  private var documentBridgeRetries = 0
  private val requestOpenDocument = 4201

  private fun attachDocumentBridge() {
    if (documentBridgeAttached) return
    val web = findWebView(window.decorView)
    if (web == null) {
      // Tauri creates the webview asynchronously; retry for ~30s, then give
      // up quietly (the picker just won't exist in that pathological case).
      documentBridgeRetries += 1
      if (documentBridgeRetries > 60) return
      android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ attachDocumentBridge() }, 500)
      return
    }
    documentBridgeAttached = true
    web.addJavascriptInterface(object {
      @android.webkit.JavascriptInterface
      fun openDocument() {
        runOnUiThread { launchDocumentPicker() }
      }
    }, "PaperlingAndroid")
  }

  private fun launchDocumentPicker() {
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
      addCategory(Intent.CATEGORY_OPENABLE)
      // "*/*", unfiltered: .md files are registered with every MIME under the
      // sun (octet-stream, text/plain, vendor types) — filtering would hide
      // exactly the files the user is looking for.
      type = "*/*"
    }
    startActivityForResult(intent, requestOpenDocument)
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode != requestOpenDocument) return
    val uri = if (resultCode == RESULT_OK) data?.data else null
    if (uri == null) {
      webviewEval("window.__paperlingPickDone && window.__paperlingPickDone(false)")
      return
    }
    try {
      val name = queryDisplayName(uri) ?: "picked.md"
      val safe = name.replace(Regex("[/\\\\\\\\:*?\\"<>|]"), "_")
      val dir = File(cacheDir, "open")
      dir.mkdirs()
      val outFile = File(dir, safe)
      contentResolver.openInputStream(uri)?.use { input ->
        outFile.outputStream().use { output -> input.copyTo(output) }
      } ?: run {
        webviewEval("window.__paperlingPickDone && window.__paperlingPickDone(false)")
        return
      }
      val js = "window.__paperlingOpenFile && window.__paperlingOpenFile(" +
        JSONObject.quote(outFile.absolutePath) + ", " + JSONObject.quote(safe) + ")"
      webviewEval(js)
    } catch (e: Exception) {
      android.util.Log.e("Paperling", "Failed to import the picked file", e)
      webviewEval("window.__paperlingPickDone && window.__paperlingPickDone(false)")
    }
  }

  private fun webviewEval(js: String) {
    findWebView(window.decorView)?.evaluateJavascript(js, null)
  }

  // A file manager "Open with Paperling" hands us a content:// URI the Rust
  // file commands cannot read. Copy it into the app-private cache and leave
  // incoming.json as the handoff marker; the frontend pulls it via the
  // get_incoming_file command (take-once, like the desktop CLI-arg flow).
  private fun handleOpenIntent(intent: Intent?) {
    if (intent?.action != Intent.ACTION_VIEW) return
    val uri = intent.data ?: return
    try {
      val name = queryDisplayName(uri) ?: "opened.md"
      val safe = name.replace(Regex("[/\\\\\\\\:*?\\"<>|]"), "_")
      val dir = File(cacheDir, "open")
      dir.mkdirs()
      val outFile = File(dir, safe)
      contentResolver.openInputStream(uri)?.use { input ->
        outFile.outputStream().use { output -> input.copyTo(output) }
      } ?: return
      val payload = JSONObject()
      payload.put("path", outFile.absolutePath)
      payload.put("name", safe)
      File(cacheDir, "incoming.json").writeText(payload.toString())
    } catch (e: Exception) {
      android.util.Log.e("Paperling", "Failed to import the opened file", e)
    }
  }

  private fun queryDisplayName(uri: Uri): String? {
    if (uri.scheme == "file") {
      val path = uri.path ?: return null
      return File(path).name
    }
    try {
      contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
          val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
          if (idx >= 0) return cursor.getString(idx)
        }
      }
    } catch (e: Exception) {
      // Fall through to the last path segment.
    }
    return uri.lastPathSegment
  }
}
`;

const fail = (msg, content, path) => {
    console.error(`::error::${msg}`);
    console.error(`----- ${path} -----`);
    console.error(content);
    process.exit(1);
};

const genDir = process.argv[2];
if (!genDir) {
    console.error("Usage: node patch-android-open-with.mjs <gen/android>");
    process.exit(1);
}

// ---- 1. AndroidManifest.xml: VIEW intent-filter ----
const manifestPath = join(genDir, "app", "src", "main", "AndroidManifest.xml");
let manifest;
try {
    manifest = readFileSync(manifestPath, "utf8");
} catch (err) {
    console.error(`::error::Cannot read ${manifestPath}: ${err.message}`);
    process.exit(1);
}

if (manifest.includes(MANIFEST_MARKER)) {
    console.log(`${manifestPath}: already patched (${MANIFEST_MARKER})`);
} else {
    const activityClose = "</activity>";
    if (!manifest.includes(activityClose)) {
        fail("Anchor `</activity>` not found in AndroidManifest.xml — the Tauri template changed; update this script.", manifest, manifestPath);
    }
    manifest = manifest.replace(activityClose, `${INTENT_FILTER_XML}    ${activityClose}`);
    if (!manifest.includes(MANIFEST_MARKER)) fail("Manifest patch did not apply (marker missing).", manifest, manifestPath);
    writeFileSync(manifestPath, manifest);
    console.log(`Patched ${manifestPath}: + VIEW intent-filter (markdown/text)`);
}

// ---- 2. MainActivity.kt: insets + intent capture ----
const activityPath = join(genDir, "app", "src", "main", "java");
let activityFile;
try {
    // The package dir mirrors the app identifier; find MainActivity.kt anywhere below java/.
    const { readdirSync, statSync } = await import("node:fs");
    const walk = (dir) =>
        readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            const p = join(dir, e.name);
            return e.isDirectory() ? walk(p) : e.name === "MainActivity.kt" ? [p] : [];
        });
    const found = walk(activityPath);
    if (found.length !== 1) fail(`Expected exactly one MainActivity.kt under ${activityPath}, found ${found.length}.`, "", activityPath);
    activityFile = found[0];
} catch (err) {
    console.error(`::error::Cannot locate MainActivity.kt: ${err.message}`);
    process.exit(1);
}

let activity;
try {
    activity = readFileSync(activityFile, "utf8");
} catch (err) {
    console.error(`::error::Cannot read ${activityFile}: ${err.message}`);
    process.exit(1);
}

if (activity.includes(ACTIVITY_MARKER)) {
    console.log(`${activityFile}: already patched (${ACTIVITY_MARKER})`);
    process.exit(0);
}

// 2a. Imports: insert after the last existing import line.
if (!/^import android\.os\.Bundle$/m.test(activity)) {
    fail("Anchor `import android.os.Bundle` not found in MainActivity.kt — the Tauri template changed; update this script.", activity, activityFile);
}
activity = activity.replace(/(^import .*$)/m, `$1\n${ACTIVITY_IMPORTS}`);

// 2b. Class body: replace the onCreate block + closing brace with the full
//     patched body. Tolerate the exact template shape first, then a looser
//     regex for minor drift.
const exactPattern =
    /  override fun onCreate\(savedInstanceState: Bundle\?\) \{\n(?:.*\n)*?  \}\n\}\s*$/;
const simplePattern =
    /override fun onCreate\(savedInstanceState: Bundle\?\) \{[\s\S]*\n\}\s*$/;
if (exactPattern.test(activity)) {
    activity = activity.replace(exactPattern, ACTIVITY_BODY);
} else if (simplePattern.test(activity)) {
    activity = activity.replace(simplePattern, ACTIVITY_BODY);
} else {
    fail("Anchor `onCreate(savedInstanceState: Bundle?)` block not found in MainActivity.kt — the Tauri template changed; update this script.", activity, activityFile);
}

if (!activity.includes(ACTIVITY_MARKER) || !activity.includes("handleOpenIntent")) {
    fail("MainActivity patch did not apply (markers missing).", activity, activityFile);
}
writeFileSync(activityFile, activity);
console.log(`Patched ${activityFile}:`);
console.log("  + system-bar inset padding (status/cutout/nav)");
console.log("  + ACTION_VIEW capture (content:// copied to cache, incoming.json marker)");
console.log("  + app-style back handler (IME -> web app -> finish)");
console.log("  + system document picker bridge (PaperlingAndroid.openDocument)");

// ---- 3. Launcher icon safe zone ----
//
// `tauri icon` generates the adaptive-icon foreground at the full 108dp
// canvas with the logo edge-to-edge; launchers mask that to a ~72dp circle or
// squircle, so the logo's outer strokes were visibly clipped on the phone
// (reproduced locally by simulating the mask). Routing the foreground through
// an inset drawable scales it to 60% of the canvas — exactly the 66dp
// guaranteed-visible safe zone — for both the square and round variants.
const ICON_MARKER = "PAPERLING-ICON-INSET";
const resDir = join(genDir, "app", "src", "main", "res");

const foregroundSource = ["xxxhdpi", "xxhdpi", "xhdpi", "hdpi", "mdpi"]
    .map((d) => join(resDir, `mipmap-${d}`, "ic_launcher_foreground.png"))
    .find((p) => existsSync(p));
if (!foregroundSource) {
    fail("No mipmap-*/ic_launcher_foreground.png found — run `tauri icon` / the icon copy step before this patch.", "", resDir);
}
if (!existsSync(join(resDir, "values", "ic_launcher_background.xml"))) {
    fail("values/ic_launcher_background.xml missing — the adaptive background color must exist for the inset XML to compile.", "", resDir);
}

const INSET_DRAWABLE_XML = `\
<?xml version="1.0" encoding="utf-8"?>
<!-- ${ICON_MARKER}: the generated foreground fills the whole 108dp adaptive
     icon canvas, so launcher masks (~72dp circle/squircle) clipped the logo.
     The inset scales it into the guaranteed-visible safe zone. -->
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@mipmap/ic_launcher_foreground"
    android:insetLeft="20%"
    android:insetTop="20%"
    android:insetRight="20%"
    android:insetBottom="20%" />
`;

const ADAPTIVE_ICON_XML = `\
<?xml version="1.0" encoding="utf-8"?>
<!-- ${ICON_MARKER}: foreground goes through the inset drawable so the logo
     stays inside the launcher mask's safe zone. -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <foreground android:drawable="@drawable/ic_launcher_foreground" />
    <background android:drawable="@color/ic_launcher_background" />
</adaptive-icon>
`;

const drawableDir = join(resDir, "drawable");
mkdirSync(drawableDir, { recursive: true });
writeFileSync(join(drawableDir, "ic_launcher_foreground.xml"), INSET_DRAWABLE_XML);

const anydpiDir = join(resDir, "mipmap-anydpi-v26");
mkdirSync(anydpiDir, { recursive: true });
writeFileSync(join(anydpiDir, "ic_launcher.xml"), ADAPTIVE_ICON_XML);
writeFileSync(join(anydpiDir, "ic_launcher_round.xml"), ADAPTIVE_ICON_XML);
console.log(`Patched ${resDir}: adaptive-icon foreground inset into the launcher safe zone`);
