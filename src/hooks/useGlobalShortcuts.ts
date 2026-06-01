import { useEffect, useRef } from "react";

/** Everything the global keyboard handler needs. Kept in a ref so the window
 *  listener is attached once and never re-bound on a handler/state change. */
export interface ShortcutHandlers {
    handleOpenFile: () => void;
    handleSaveFile: () => void;
    handleSaveAs: () => void;
    handleNewFile: () => void;
    handleToggleMode: () => void;
    handleToggleSplit: () => void;
    handleToggleFileExplorer: () => void;
    handleToggleTOC: () => void;
    openCheatsheet: () => void;
    openPalette: () => void;
    openSettings: () => void;
    hasFile: boolean;
    content: string;
}

/**
 * App-wide keyboard shortcuts, mounted once on the window. Reads the latest
 * handlers/state through a ref so the listener never has to be torn down and
 * re-added on a keystroke (which an effect dep-array on `content` would force).
 */
export function useGlobalShortcuts(handlers: ShortcutHandlers) {
    const ref = useRef(handlers);
    ref.current = handlers;

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const s = ref.current;
            // Ctrl+Shift+E - Toggle file explorer (check before Ctrl+E)
            if (e.ctrlKey && e.shiftKey && e.key === "E") {
                e.preventDefault();
                if (s.hasFile) s.handleToggleFileExplorer();
                return;
            }
            // Ctrl+Shift+O - Toggle TOC (check before Ctrl+O)
            if (e.ctrlKey && e.shiftKey && e.key === "O") {
                e.preventDefault();
                if (s.hasFile) s.handleToggleTOC();
                return;
            }
            // Ctrl+O - Open file (without Shift). Match both cases so CapsLock
            // (where an unshifted key reports uppercase) doesn't dead-zone it.
            if (e.ctrlKey && !e.shiftKey && (e.key === "o" || e.key === "O")) {
                e.preventDefault();
                s.handleOpenFile();
            }
            // Ctrl+S - Save file. Match "s" AND "S": with CapsLock on, an unshifted
            // Ctrl+S reports e.key === "S", which previously fell through and made
            // the keypress silently do nothing (while Ctrl+Shift+S still worked).
            if (e.ctrlKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {
                e.preventDefault();
                if (s.hasFile || s.content) s.handleSaveFile();
            }
            // Ctrl+Shift+S - Save As
            if (e.ctrlKey && e.shiftKey && (e.key === "s" || e.key === "S")) {
                e.preventDefault();
                if (s.hasFile || s.content) s.handleSaveAs();
            }
            // Ctrl+N - New file (case-insensitive for the CapsLock case)
            if (e.ctrlKey && !e.shiftKey && (e.key === "n" || e.key === "N")) {
                e.preventDefault();
                s.handleNewFile();
            }
            // Ctrl+E - Toggle preview/code mode (without Shift, case-insensitive)
            if (e.ctrlKey && !e.shiftKey && (e.key === "e" || e.key === "E")) {
                e.preventDefault();
                if (s.hasFile) s.handleToggleMode();
            }
            // Ctrl+\ - Toggle split view
            if (e.ctrlKey && !e.shiftKey && e.key === "\\") {
                e.preventDefault();
                if (s.hasFile) s.handleToggleSplit();
            }
            // ? - Show cheatsheet (only when no input is focused)
            if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
                const target = e.target as HTMLElement | null;
                const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
                if (!isTyping) {
                    e.preventDefault();
                    s.openCheatsheet();
                }
            }
            // Ctrl+P / Ctrl+Shift+P - command palette
            if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
                e.preventDefault();
                s.openPalette();
            }
            // Ctrl+, - Settings
            if ((e.ctrlKey || e.metaKey) && e.key === ",") {
                e.preventDefault();
                s.openSettings();
            }
            // AI assist - Alt+J everywhere, Cmd+J on macOS. Handled here (window
            // level) rather than only in the editor so it fires regardless of
            // focus; the editor opens the bubble via the marklite:ai-assist
            // listener. (Ctrl+J is reserved by WebView2 on Windows, hence Alt+J.)
            const isAltJ = e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "j" || e.key === "J" || e.code === "KeyJ");
            const isCmdJ = e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "j" || e.key === "J");
            if (isAltJ || isCmdJ) {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent("marklite:ai-assist"));
            }
        };

        window.addEventListener("keydown", handleKeyDown);

        // Defense-in-depth for Ctrl+J: Edge/Chrome/WebView2 treat Ctrl+J as a
        // "browser accelerator" for Downloads. On WebView2 (Windows) the page
        // never sees this keydown, so JS can't help — users have Alt+J as the
        // working alias there. On WebKitGTK (Linux) and WKWebView (macOS) the
        // event DOES reach the page; we capture-phase preventDefault here so the
        // host webview's default action is suppressed regardless of which
        // element is focused (textarea, palette input, settings, etc.).
        const blockCtrlJ = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === "j" || e.key === "J")) {
                e.preventDefault();
            }
        };
        window.addEventListener("keydown", blockCtrlJ, { capture: true });

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keydown", blockCtrlJ, { capture: true } as EventListenerOptions);
        };
    }, []);
}
