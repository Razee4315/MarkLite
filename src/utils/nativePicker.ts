/**
 * One-call handle to the Android system document picker (SAF).
 *
 * The in-app file browser can only see folders the Rust file commands can
 * read — on Android that's effectively the app-private notes root. Opening a
 * .md from anywhere (Downloads, Drive, SD card) needs ACTION_OPEN_DOCUMENT,
 * which lives on the native side: the patched MainActivity exposes a tiny
 * `PaperlingAndroid` JavascriptInterface that launches the picker, copies the
 * picked content:// file into the app cache, and hands the real path to the
 * webview through window.__paperlingOpenFile (the same bridge "Open with"
 * intents use).
 *
 * Returns false when the native bridge isn't there (old build / desktop /
 * browser dev), so callers can show a guiding message instead of no-op'ing.
 */
export function openSystemFilePicker(): boolean {
    const bridge = (window as unknown as {
        PaperlingAndroid?: { openDocument?: () => void };
    }).PaperlingAndroid;
    if (!bridge?.openDocument) return false;
    bridge.openDocument();
    return true;
}
