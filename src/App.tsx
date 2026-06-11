import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen, TauriEvent } from "@tauri-apps/api/event";
import { Window } from "@tauri-apps/api/window";

import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { ThemeProvider } from "./context/ThemeContext";
import { TitleBar } from "./components/TitleBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { CodeEditor } from "./components/CodeEditor";
import { StatusBar } from "./components/StatusBar";
import { ModeToggle, type ViewMode } from "./components/ModeToggle";
import { Toast } from "./components/Toast";
import { SplitDivider } from "./components/SplitDivider";
import { createScrollSync } from "./utils/scrollSync";
import { type PaletteCommand } from "./components/CommandPalette";
import { useToast } from "./hooks/useToast";
import { useGlobalShortcuts } from "./hooks/useGlobalShortcuts";

// === Lazy-loaded screens / dialogs ===
//
// Cold-start budget: the welcome screen is what the user sees first, and it
// doesn't need react-markdown, jspdf, the settings modal, the command
// palette, or any sidebar panel to render. Importing them eagerly meant
// 300 kB+ of JS had to parse before the welcome screen could paint. Each of
// these is now its own chunk, fetched only when its surface is mounted.
//
// React.lazy expects a default export; our components are named exports, so
// we adapt with the `.then(m => ({ default: m.X }))` shim.
const MarkdownPreview = lazy(() =>
    import("./components/MarkdownPreview").then((m) => ({ default: m.MarkdownPreview }))
);
const FileExplorer = lazy(() =>
    import("./components/FileExplorer").then((m) => ({ default: m.FileExplorer }))
);
const TableOfContents = lazy(() =>
    import("./components/TableOfContents").then((m) => ({ default: m.TableOfContents }))
);
const SettingsModal = lazy(() =>
    import("./components/SettingsModal").then((m) => ({ default: m.SettingsModal }))
);
const StatsDialog = lazy(() =>
    import("./components/StatsDialog").then((m) => ({ default: m.StatsDialog }))
);
const CommandPalette = lazy(() =>
    import("./components/CommandPalette").then((m) => ({ default: m.CommandPalette }))
);
const ShortcutCheatsheet = lazy(() =>
    import("./components/ShortcutCheatsheet").then((m) => ({ default: m.ShortcutCheatsheet }))
);
const UnsavedChangesDialog = lazy(() =>
    import("./components/UnsavedChangesDialog").then((m) => ({ default: m.UnsavedChangesDialog }))
);
const AIPanel = lazy(() =>
    import("./components/AIPanel").then((m) => ({ default: m.AIPanel }))
);
// Update popup — mounts on every launch, renders nothing unless a newer
// signed release is found on GitHub (and the user hasn't skipped it).
const UpdateDialog = lazy(() =>
    import("./components/UpdateDialog").then((m) => ({ default: m.UpdateDialog }))
);
import { getRecentFiles } from "./utils/persistence";
import {
  addRecentFile,
  getAIConfig,
  getAIEnabled,
  initAIKey,
  getLastFile,
  getSavedViewMode,
  getSpellCheck,
  getSplitRatio,
  getToolbarEnabled,
  getTourDone,
  getTypewriterMode,
  getWordWrap,
  setAIEnabled,
  setLastFile,
  setSavedViewMode,
  setSpellCheck,
  setSplitRatio,
  setToolbarEnabled,
  setTourDone,
  setTypewriterMode,
  setWordWrap,
} from "./utils/persistence";
import { getAutoSave } from "./utils/persistence";
import { pickBootFile } from "./utils/boot";
import { countSourceWords, countWords } from "./utils/documentStats";
import { Tour } from "./components/Tour";
import { PreviewFindBar } from "./components/PreviewFindBar";

interface FileData {
  path: string;
  name: string;
  content: string;
  size: number;
  line_count: number;
  /** Last-modified time (ms since epoch) — used to detect external edits. */
  modified: number;
}

// Platform-aware AI shortcut hint. Windows uses Alt+J because WebView2 reserves
// Ctrl+J for its Downloads UI before the page sees it; macOS shows ⌘J. (AI-02.)
const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
const AI_SHORTCUT = IS_MAC ? "⌘J" : "Alt+J";

// Width of the right-side AI panel; the editor/preview area reserves this much
// padding-right when it's open so content reflows beside it (not under it).
const AI_PANEL_WIDTH = 400;

// The launch-file resolution must run exactly once per webview load. React
// StrictMode double-invokes effects in dev: without this guard the second run
// would find the CLI file already consumed (the backend take()s it) and start
// a racing last-session restore that can overwrite the just-opened file.
// Module-level on purpose — StrictMode remounts share module state.
let bootResolved = false;

/**
 * Returns a value that lags behind `value` by `delay` ms. Each new `value`
 * resets the timer, so during continuous typing the returned value is stable
 * and only commits to the latest input once the user pauses. Used to keep the
 * heavy markdown preview off the typing critical path without leaving the
 * preview "stuck" the way useDeferredValue can under starvation.
 *
 * Implementation notes:
 *  - All deps the effect reads are listed (`value`, `delay`). No stale-closure
 *    surprises and no eslint-disable, so React's strict-mode dev checks don't
 *    flag this as a "Maximum update depth exceeded" candidate.
 *  - When `value` is already equal to `debounced`, scheduling a setTimeout
 *    that calls setDebounced with the same value is harmless: React bails out
 *    of the re-render via Object.is on the new state. So we skip the explicit
 *    early-return; it isn't worth the extra dep.
 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

function AppContent() {
  // File state
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);

  // UI state
  const [mode, setMode] = useState<ViewMode>(() => getSavedViewMode());
  const [showCheatsheet, setShowCheatsheet] = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showTour, setShowTour] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [splitRatio, setSplitRatioState] = useState<number>(() => getSplitRatio());
  const [aiConfig, setAiConfigState] = useState(() => getAIConfig());
  const [aiEnabled, setAiEnabledState] = useState<boolean>(() => getAIEnabled());
  const [typewriterModeEnabled, setTypewriterModeEnabled] = useState<boolean>(() => getTypewriterMode());
  const [toolbarVisible, setToolbarVisible] = useState<boolean>(() => getToolbarEnabled());
  const [wordWrapEnabled, setWordWrapEnabled] = useState<boolean>(() => getWordWrap());
  const [spellCheckEnabled, setSpellCheckEnabled] = useState<boolean>(() => getSpellCheck());
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  // True while the launch-time file resolution (OS-opened CLI file, then
  // last-session restore) is still in flight. Shows a neutral splash instead
  // of flashing the WelcomeScreen for a frame. Starts true unconditionally:
  // whether a CLI file exists is only known after asking the backend, and the
  // no-file case resolves in a couple of milliseconds anyway.
  const [booting, setBooting] = useState<boolean>(true);
  // Editor selection range. Collapsed (start === end) means no selection;
  // when start < end we surface a "N words selected" chip in the status bar.
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [isLoading, setIsLoading] = useState(false);

  // Pending file to open after unsaved changes dialog
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const [showUnsavedBeforeOpen, setShowUnsavedBeforeOpen] = useState(false);
  // Unsaved-changes dialog for window close (Alt+F4, taskbar close, the title
  // bar X). The Tauri close-requested handler below intercepts ALL of them.
  const [showUnsavedBeforeClose, setShowUnsavedBeforeClose] = useState(false);
  // Find bar over the reader-mode preview (Ctrl+F when mode === "preview").
  const [previewFindOpen, setPreviewFindOpen] = useState(false);
  // Autosave: save a moment after the user stops typing (Settings → Editor).
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(() => getAutoSave());

  // Sidebar panel state
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [showTOC, setShowTOC] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  // Proposed document from Agent mode, shown as an inline diff for accept/reject.
  const [proposedDoc, setProposedDoc] = useState<string | null>(null);

  // Preview scroll position
  const [previewLine, setPreviewLine] = useState(1);

  // Toast notifications (state + show/hide helpers live in a hook).
  const { toast, showToast, hideToast } = useToast();

  // Export HTML content ref - captures from visible preview
  const previewRef = useRef<HTMLDivElement>(null);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  // Bidirectional scroll sync between editor and preview (split mode only).
  // Singleton instance — one sync controller for the lifetime of the app.
  const scrollSyncRef = useRef(createScrollSync());

  // Enable/disable based on view mode
  useEffect(() => {
    scrollSyncRef.current.setEnabled(mode === "split");
  }, [mode]);

  // Reader-mode find only makes sense over the preview; close it (and drop
  // its highlights) when the user switches to code or split.
  useEffect(() => {
    if (mode !== "preview") setPreviewFindOpen(false);
  }, [mode]);

  const registerCodeScroller = useCallback(
    (s: import("./utils/scrollSync").Scroller | null) => scrollSyncRef.current.register("code", s),
    []
  );
  const registerPreviewScroller = useCallback(
    (s: import("./utils/scrollSync").Scroller | null) => scrollSyncRef.current.register("preview", s),
    []
  );
  const onCodeScrollFraction = useCallback(
    (f: number) => scrollSyncRef.current.notify("code", f),
    []
  );
  const onPreviewScrollFraction = useCallback(
    (f: number) => scrollSyncRef.current.notify("preview", f),
    []
  );

  // Derived state
  const isDirty = content !== originalContent;
  // "Has a buffer" — true once a file is opened OR a blank Untitled buffer is started
  const hasFile = filePath !== null || fileName !== null;

  // First-run welcome tour: auto-start the first time a buffer is on screen.
  // The tour anchors to elements (mode toggle, editor panes) that only exist
  // once a file is open, so it can't run over the WelcomeScreen.
  useEffect(() => {
    if (hasFile && !booting && !getTourDone()) setShowTour(true);
  }, [hasFile, booting]);

  const handleCloseTour = useCallback(() => {
    setTourDone(true);
    setShowTour(false);
  }, []);

  // PERF: Typing in the editor calls setContent on every keystroke, which would
  // synchronously re-render every consumer of `content` — including the markdown
  // preview, which runs remark-gfm + rehype-highlight + react-markdown over the
  // entire document. On a few-hundred-line file that's 50-200ms of work and the
  // textarea feels laggy because React can't commit the new value until the tree
  // is reconciled.
  //
  // We debounce the value passed to those heavy consumers by ~80ms — short
  // enough to feel real-time during a normal pause between keystrokes, long
  // enough that fast typing skips many intermediate re-renders. The editor
  // itself still uses live `content` so the glyph you typed appears immediately.
  // (We previously used useDeferredValue here, but under React StrictMode + the
  // bursty state churn at file-open it could starve and leave the preview
  // showing the empty initial value.)
  // Scale the debounce with document size: tiny docs feel instant at 80ms, but a
  // multi-thousand-line doc benefits from coalescing more keystrokes before the
  // (still heavy) full re-parse fires. Combined with the preview's startTransition
  // render, this keeps typing responsive on large files. PREVIEW-01.
  const previewDebounceMs = content.length > 40_000 ? 250 : content.length > 12_000 ? 160 : 80;
  const deferredContent = useDebouncedValue(content, previewDebounceMs);

  // Word/char counts feed the status bar — fine to lag a frame behind on huge
  // docs, so they read deferred too. countSourceWords is the SAME pipeline the
  // stats dialog uses (strips frontmatter/code, ignores markdown syntax), so
  // the status bar and the dialog always agree. STATS-01.
  const wordCount = useMemo(() => countSourceWords(deferredContent), [deferredContent]);
  const charCount = deferredContent.length;
  // Selection word count, when the user has a non-empty range highlighted.
  // Reads LIVE `content` (not deferredContent) since the selection range and
  // the underlying text must agree — sliding by 80ms would briefly count words
  // from a stale buffer right after a fast edit. The slice is cheap regardless.
  // Uses countWords (no frontmatter/code stripping): a selection inside a code
  // block should still report what's selected.
  const selectionLength = selectionRange.end - selectionRange.start;
  const selectionWordCount = useMemo(
    () => (selectionLength > 0 ? countWords(content.slice(selectionRange.start, selectionRange.end)) : 0),
    [content, selectionRange.start, selectionRange.end, selectionLength]
  );
  // Average adult reading speed for prose: ~200 wpm.
  const readingTimeMin = useMemo(() => wordCount / 200, [wordCount]);

  // Known on-disk modified time (ms). Compared against a fresh stat on window
  // focus to detect the file changing under us (sync tools, other editors).
  const knownMtimeRef = useRef<number>(0);

  // Load file from path (with unsaved changes check)
  const loadFileDirect = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const fileData = await invoke<FileData>("read_file", { path });
      setFilePath(fileData.path);
      setFileName(fileData.name);
      setContent(fileData.content);
      setOriginalContent(fileData.content);
      setFileSize(fileData.size);
      knownMtimeRef.current = fileData.modified ?? 0;
      // Track recents + last-opened for restore-on-launch
      addRecentFile(fileData.path, fileData.name);
      setLastFile(fileData.path);
    } catch (err) {
      console.error("Failed to load file:", err);
      // Surface the actual error from Rust so "File too large" / "File not
      // found" reaches the user instead of a generic message — without this,
      // hitting the new 50 MB cap looked exactly like a permission error.
      const msg = typeof err === "string" ? err : (err as { message?: string })?.message;
      showToast(msg || "Failed to open file", "error");
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  // Persist view mode + restore last file on mount
  useEffect(() => {
    setSavedViewMode(mode);
  }, [mode]);

  useEffect(() => {
    setSplitRatio(splitRatio);
  }, [splitRatio]);

  useEffect(() => { setTypewriterMode(typewriterModeEnabled); }, [typewriterModeEnabled]);
  useEffect(() => { setToolbarEnabled(toolbarVisible); }, [toolbarVisible]);
  useEffect(() => { setWordWrap(wordWrapEnabled); }, [wordWrapEnabled]);
  useEffect(() => { setSpellCheck(spellCheckEnabled); }, [spellCheckEnabled]);
  useEffect(() => { setAIEnabled(aiEnabled); }, [aiEnabled]);

  // Cross-component event listeners — settings menu and command palette toggle these
  useEffect(() => {
    const handlers: Array<[string, (e: Event) => void]> = [
      ["paperling:typewriter-toggle", (e) => setTypewriterModeEnabled(!!(e as CustomEvent).detail?.enabled)],
      ["paperling:toolbar-toggle", (e) => setToolbarVisible(!!(e as CustomEvent).detail?.enabled)],
      ["paperling:wordwrap-toggle", (e) => setWordWrapEnabled(!!(e as CustomEvent).detail?.enabled)],
      ["paperling:spellcheck-toggle", (e) => setSpellCheckEnabled(!!(e as CustomEvent).detail?.enabled)],
      ["paperling:autosave-toggle", (e) => setAutoSaveEnabled(!!(e as CustomEvent).detail?.enabled)],
      // Opened from the title-bar settings dropdown's "More settings…" entry.
      ["paperling:open-settings", () => setShowSettings(true)],
      // Alt+J with no selection opens the docked AI side panel. The editor's
      // ai-assist handler decides bubble (selection) vs panel (no selection).
      // Reads the persisted flag live (this effect mounts once) so the panel
      // can't be opened while AI is switched off in Settings.
      ["paperling:toggle-ai-panel", () => { if (getAIEnabled()) setShowAIPanel((v) => !v); }],
      // Settings master switch for all AI surfaces; closing the panel here
      // keeps it from lingering open after AI is turned off.
      ["paperling:ai-enabled-toggle", (e) => {
        const enabled = !!(e as CustomEvent).detail?.enabled;
        setAiEnabledState(enabled);
        if (!enabled) setShowAIPanel(false);
      }],
    ];
    handlers.forEach(([k, h]) => window.addEventListener(k, h));

    // Note: there used to be a `storage` event listener here that re-read the
    // AI config. It was dead code — the spec only fires `storage` events on
    // OTHER documents/tabs that mutate localStorage, never on the writing
    // document. The actual refresh path is the explicit `setAiConfigState(
    // getAIConfig())` call in SettingsModal's onClose, which works correctly.

    return () => {
      handlers.forEach(([k, h]) => window.removeEventListener(k, h));
    };
  }, []);

  // Prefetch the heaviest lazy chunks during browser idle so the first time
  // the user actually opens a file or a sidebar, the bundle is already in
  // cache. Without this we'd block the file-open click on a network fetch
  // for ~340 kB of react-markdown. The prefetch is fire-and-forget; if the
  // user never opens a file before closing the app, no harm done.
  useEffect(() => {
    type IdleApi = (cb: () => void, opts?: { timeout?: number }) => number;
    const ric: IdleApi = (typeof window !== "undefined" && (window as unknown as { requestIdleCallback?: IdleApi }).requestIdleCallback)
        ? (window as unknown as { requestIdleCallback: IdleApi }).requestIdleCallback
        : ((cb) => window.setTimeout(cb, 600) as unknown as number);
    const id = ric(() => {
      // Markdown rendering pipeline is the single biggest deferred chunk;
      // pull it in the moment the welcome screen has settled. The other
      // dialogs are tiny and aren't worth racing the network for.
      import("./components/MarkdownPreview").catch(() => {/* offline / cancelled */ });
    }, { timeout: 1500 });
    return () => {
      const cancel = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (cancel) cancel(id);
      else window.clearTimeout(id);
    };
  }, []);

  // Hydrate the AI API key from the OS keychain on launch, then refresh the
  // config so the editor's AI bubble has the key ready. SECURITY-01.
  useEffect(() => {
    initAIKey().then(() => setAiConfigState(getAIConfig()));
  }, []);

  useEffect(() => {
    // Resolve the launch file once on app start. PULL model: ask the backend
    // for an OS-opened file (double-clicked .md → CLI arg) when WE are ready,
    // instead of the backend pushing an event after an arbitrary delay. The
    // old push design raced the webview: on slow cold starts the event fired
    // before the listener existed and was lost, so the last-session restore
    // won and the app reopened the previous file instead of the clicked one.
    if (bootResolved) return;
    bootResolved = true;
    (async () => {
      let cliFile: string | null = null;
      try {
        cliFile = await invoke<string | null>("get_cli_file");
      } catch {
        // Browser dev mode / older backend without the command — restore only.
      }

      const target = pickBootFile(cliFile, getLastFile());
      if (!target.path) {
        setBooting(false);
        return;
      }

      try {
        const fileData = await invoke<FileData>("read_file", { path: target.path });
        setFilePath(fileData.path);
        setFileName(fileData.name);
        setContent(fileData.content);
        setOriginalContent(fileData.content);
        setFileSize(fileData.size);
        knownMtimeRef.current = fileData.modified ?? 0;
        // Bump the recents entry's timestamp to "now" so it sorts as
        // most-recent, and persist as the session file so the next plain
        // launch restores what the user actually had open.
        addRecentFile(fileData.path, fileData.name);
        setLastFile(fileData.path);
      } catch (err) {
        const msg = typeof err === "string" ? err : (err as { message?: string })?.message || "";
        if (target.source === "cli") {
          // The user explicitly asked for this file — always tell them why
          // it didn't open (moved/deleted/too large).
          showToast(`Could not open file: ${msg || target.path}`, "error");
        } else {
          // Stale session file (moved / deleted) — fail quietly like before,
          // except the TooLarge case, which deserves an explanation.
          setLastFile(null);
          if (/too large/i.test(msg)) {
            showToast(`Could not restore last file: ${msg}`, "error");
          }
        }
      } finally {
        setBooting(false);
      }
    })();
    // Run only once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Latest content + originalContent are read via refs inside `loadFile` so
  // its identity stays stable across keystrokes. Without this, every typed
  // character would change `loadFile`'s reference, which would tear down and
  // re-register the Tauri DRAG_DROP listener, the file-open-from-cli listener,
  // and the global keydown handler — all of which depend on `loadFile` —
  // causing per-keystroke listener churn (and a small but real OS-level IPC
  // round-trip for the Tauri ones).
  const contentRef = useRef(content);
  contentRef.current = content;
  const originalContentRef = useRef(originalContent);
  originalContentRef.current = originalContent;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;

  // Intercept EVERY window-close path (Alt+F4, taskbar close, the title bar X,
  // OS shutdown) and route dirty buffers through the unsaved-changes dialog.
  // Previously only the custom X button checked isDirty, so Alt+F4 silently
  // discarded unsaved work. The title bar X calls Window.close(), which also
  // fires this event — one interception point for all of them. CLOSE-01.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let mounted = true;
    try {
      Window.getCurrent()
        .onCloseRequested((event) => {
          if (contentRef.current !== originalContentRef.current) {
            event.preventDefault();
            setShowUnsavedBeforeClose(true);
          }
        })
        .then((fn) => {
          if (mounted) unlisten = fn;
          else fn();
        })
        .catch(() => {/* browser dev mode — no Tauri window */});
    } catch {/* browser dev mode */}
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  // Close-dialog handlers. destroy() skips the close-requested event, so we
  // don't loop back into the dialog we just answered.
  const forceCloseWindow = useCallback(() => {
    Window.getCurrent().destroy().catch(() => {/* browser dev mode */});
  }, []);

  const handleSaveAndCloseWindow = useCallback(async () => {
    setShowUnsavedBeforeClose(false);
    const path = filePathRef.current;
    if (path) {
      try {
        await invoke("save_file", { path, content: contentRef.current });
      } catch (err) {
        const msg = typeof err === "string" ? err : (err as { message?: string })?.message;
        showToast(msg || "Failed to save file", "error");
        return; // don't close on a failed save — the user would lose the buffer
      }
    } else {
      // Untitled buffer: prompt for a location; cancel keeps the app open.
      const selected = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: fileName ?? undefined,
      });
      if (!selected) return;
      try {
        await invoke("save_file", { path: selected, content: contentRef.current });
      } catch {
        showToast("Failed to save file", "error");
        return;
      }
    }
    forceCloseWindow();
  }, [fileName, forceCloseWindow, showToast]);

  const handleDiscardAndCloseWindow = useCallback(() => {
    setShowUnsavedBeforeClose(false);
    forceCloseWindow();
  }, [forceCloseWindow]);

  // External-change detection: when the window regains focus, stat the open
  // file. If it changed on disk and the buffer is clean, reload silently; if
  // the buffer is dirty, warn that saving will overwrite. EXT-01.
  useEffect(() => {
    let checking = false;
    const checkExternalChange = async () => {
      const path = filePathRef.current;
      if (!path || checking) return;
      checking = true;
      try {
        const info = await invoke<{ modified: number }>("get_file_info", { path });
        const known = knownMtimeRef.current;
        if (known > 0 && info.modified > known) {
          // Update first so a failed/declined reload doesn't re-toast forever.
          knownMtimeRef.current = info.modified;
          if (contentRef.current === originalContentRef.current) {
            await loadFileDirect(path);
            showToast("File changed on disk, reloaded the latest version", "info");
          } else {
            showToast("This file changed on disk. Saving will overwrite those changes.", "error");
          }
        }
      } catch {/* file gone or stat failed — the save path will surface it */}
      finally { checking = false; }
    };
    window.addEventListener("focus", checkExternalChange);
    return () => window.removeEventListener("focus", checkExternalChange);
  }, [loadFileDirect, showToast]);

  // Autosave: once enabled, persist 1.5s after the last edit. Silent (the
  // status dot already flips to Saved); only failures surface a toast, and
  // only once per failure streak so a broken disk doesn't spam.
  const autosaveFailedRef = useRef(false);
  useEffect(() => {
    if (!autoSaveEnabled || !filePath || content === originalContent) return;
    const id = window.setTimeout(async () => {
      try {
        knownMtimeRef.current = await invoke<number>("save_file", { path: filePath, content });
        setOriginalContent(content);
        autosaveFailedRef.current = false;
      } catch (err) {
        if (!autosaveFailedRef.current) {
          autosaveFailedRef.current = true;
          const msg = typeof err === "string" ? err : (err as { message?: string })?.message;
          showToast(msg || "Autosave failed", "error");
        }
      }
    }, 1500);
    return () => window.clearTimeout(id);
  }, [autoSaveEnabled, content, originalContent, filePath, showToast]);

  // Load file with unsaved changes protection
  const loadFile = useCallback(async (path: string) => {
    if (contentRef.current !== originalContentRef.current) {
      // Has unsaved changes — ask user first
      setPendingFilePath(path);
      setShowUnsavedBeforeOpen(true);
    } else {
      await loadFileDirect(path);
    }
  }, [loadFileDirect]);

  // New file: clears buffer. Used by handleNewFile and the dialog handlers.
  const startBlankFile = useCallback(() => {
    setFilePath(null);
    setFileName("Untitled.md");
    setContent("");
    setOriginalContent("");
    setFileSize(0);
    setLastFile(null);
    setMode("code");
  }, []);

  // Handlers for unsaved-before-open dialog. Supports a "__NEW__" sentinel
  // so the New File action routes through the same confirmation flow.
  const handleSaveAndOpen = useCallback(async () => {
    setShowUnsavedBeforeOpen(false);
    if (filePath) {
      try {
        knownMtimeRef.current = await invoke<number>("save_file", { path: filePath, content });
        setOriginalContent(content);
      } catch (err) {
        console.error("Failed to save file:", err);
        const msg = typeof err === "string" ? err : (err as { message?: string })?.message;
        showToast(msg || "Failed to save file", "error");
        return;
      }
    }
    if (pendingFilePath === "__NEW__") {
      startBlankFile();
    } else if (pendingFilePath) {
      await loadFileDirect(pendingFilePath);
    }
    setPendingFilePath(null);
  }, [filePath, content, pendingFilePath, loadFileDirect, showToast, startBlankFile]);

  const handleDiscardAndOpen = useCallback(async () => {
    setShowUnsavedBeforeOpen(false);
    if (pendingFilePath === "__NEW__") {
      startBlankFile();
    } else if (pendingFilePath) {
      await loadFileDirect(pendingFilePath);
    }
    setPendingFilePath(null);
  }, [pendingFilePath, loadFileDirect, startBlankFile]);

  const handleCancelOpen = useCallback(() => {
    setShowUnsavedBeforeOpen(false);
    setPendingFilePath(null);
  }, []);

  // Listen for Tauri drag-drop events
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    listen<{ paths: string[] }>(TauriEvent.DRAG_DROP, async (event) => {
      const paths = event.payload.paths;
      if (paths && paths.length > 0) {
        const firstPath = paths[0];
        // Only load markdown files
        if (firstPath.endsWith('.md') || firstPath.endsWith('.markdown')) {
          await loadFile(firstPath);
        }
      }
    }).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn(); // Component already unmounted, clean up immediately
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [loadFile]);

  // Wikilink click: resolve target relative to the current file's folder.
  // Tries `<target>.md` first, then `<target>` literal. Silently fails if neither exists.
  // SECURITY: rejects path-traversal and absolute paths so a crafted document
  // can't load arbitrary files outside the current folder.
  const handleWikilinkClick = useCallback(async (target: string) => {
    if (!filePath) return;
    const cleaned = target.trim();
    // Block traversal (`..`), path separators, drive letters, and absolute paths.
    // Wikilinks should only reference siblings in the same folder.
    if (
      !cleaned ||
      cleaned.includes("..") ||
      cleaned.includes("/") ||
      cleaned.includes("\\") ||
      cleaned.includes("\0") ||
      /^[a-zA-Z]:/.test(cleaned)
    ) {
      showToast(`Invalid wikilink target: [[${target}]]`, "error");
      return;
    }
    const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    const dir = lastSep > 0 ? filePath.slice(0, lastSep) : "";
    const sep = filePath.includes("\\") ? "\\" : "/";
    const candidates = [
      `${dir}${sep}${cleaned}.md`,
      `${dir}${sep}${cleaned}.markdown`,
      `${dir}${sep}${cleaned}`,
    ];
    for (const c of candidates) {
      try {
        // get_file_info errors when the file doesn't exist; use it as a probe
        await invoke("get_file_info", { path: c });
        loadFile(c);
        return;
      } catch {/* try next */}
    }
    showToast(`Could not resolve [[${target}]]`, "error");
  }, [filePath, loadFile, showToast]);

  const handleNewFile = useCallback(() => {
    if (content !== originalContent) {
      setPendingFilePath("__NEW__");
      setShowUnsavedBeforeOpen(true);
    } else {
      startBlankFile();
    }
  }, [content, originalContent, startBlankFile]);

  // "Replay the welcome tour" from Settings → About. The tour spotlights
  // editor chrome, so make sure a buffer exists before showing it.
  useEffect(() => {
    const h = () => {
      if (!hasFile) handleNewFile();
      setShowTour(true);
    };
    window.addEventListener("paperling:replay-tour", h);
    return () => window.removeEventListener("paperling:replay-tour", h);
  }, [hasFile, handleNewFile]);

  // Open file dialog
  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [
          {
            name: "Markdown",
            extensions: ["md", "markdown"],
          },
        ],
      });

      if (selected && typeof selected === "string") {
        await loadFile(selected);
      }
    } catch (err) {
      console.error("Failed to open file dialog:", err);
    }
  }, [loadFile]);

  // Save As — always prompts for a new path, even if a path is already set.
  const handleSaveAs = useCallback(async () => {
    const selected = await save({
      filters: [{ name: "Markdown", extensions: ["md"] }],
      defaultPath: fileName ?? undefined,
    });
    if (!selected) return;
    try {
      knownMtimeRef.current = await invoke<number>("save_file", { path: selected, content });
      setFilePath(selected);
      const name = selected.replace(/\\/g, "/").split("/").pop() || "Untitled";
      setFileName(name);
      setOriginalContent(content);
      addRecentFile(selected, name);
      setLastFile(selected);
      showToast("File saved", "success");
    } catch (err) {
      console.error("Failed to save file:", err);
      const msg = typeof err === "string" ? err : (err as { message?: string })?.message;
      showToast(msg || "Failed to save file", "error");
    }
  }, [content, fileName, showToast]);

  // Save file (Save As if no path yet)
  const handleSaveFile = useCallback(async () => {
    if (!filePath) {
      await handleSaveAs();
      return;
    }
    try {
      knownMtimeRef.current = await invoke<number>("save_file", { path: filePath, content });
      setOriginalContent(content);
      showToast("File saved", "success");
    } catch (err) {
      console.error("Failed to save file:", err);
      const msg = typeof err === "string" ? err : (err as { message?: string })?.message;
      showToast(msg || "Failed to save file", "error");
    }
  }, [filePath, content, showToast, handleSaveAs]);

  // Runtime file-open forwards. Cold-start CLI files are handled by the pull
  // in the boot effect above; this event now arrives only from the
  // single-instance plugin, when the user double-clicks another .md while
  // Paperling is already running and the second launch hands us its path.
  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;

    listen<string>("file-open-from-cli", async (event) => {
      const filePath = event.payload;
      if (filePath) {
        await loadFile(filePath);
      }
    }).then((fn) => {
      if (mounted) {
        unlisten = fn;
      } else {
        fn();
      }
    });

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [loadFile]);

  // Toggle between preview and code (skips split — split has its own shortcut)
  const handleToggleMode = useCallback(() => {
    setMode((prev) => (prev === "code" ? "preview" : "code"));
  }, []);

  const handleToggleSplit = useCallback(() => {
    setMode((prev) => (prev === "split" ? "preview" : "split"));
  }, []);

  // Toggle file explorer (mutually exclusive with TOC)
  const handleToggleFileExplorer = useCallback(() => {
    setShowFileExplorer((prev) => !prev);
    setShowTOC(false);
  }, []);

  // Toggle table of contents (mutually exclusive with file explorer)
  const handleToggleTOC = useCallback(() => {
    setShowTOC((prev) => !prev);
    setShowFileExplorer(false);
  }, []);

  // Toggle the right-side AI assistant panel.
  const handleToggleAI = useCallback(() => setShowAIPanel((v) => !v), []);

  // Agent proposed an edited document → show it as a diff to accept/reject.
  // Ensure the editor (where the diff renders) is visible.
  const handleProposeEdit = useCallback((doc: string) => {
    setProposedDoc(doc);
    setMode((m) => (m === "preview" ? "split" : m));
  }, []);

  // Review finished: commit the accepted document (or keep the original on reject).
  const handleReviewResolve = useCallback((finalDoc: string | null) => {
    if (finalDoc != null) setContent(finalDoc);
    setProposedDoc(null);
  }, []);

  // Close all panels
  const closeAllPanels = useCallback(() => {
    setShowFileExplorer(false);
    setShowTOC(false);
  }, []);

  // Handle file drop
  const handleFileDrop = useCallback(
    (path: string) => {
      loadFile(path);
    },
    [loadFile]
  );

// Handle content change
  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
  }, []);

  // Stable cursor + preview-line setters. Critical that these are useCallback
  // (not inline arrows): CodeEditor wires `onCursorChange` into a useEffect via
  // `updateCursorPosition`, and an unstable callback ref would re-run that
  // effect on every parent render, calling `updateCursorPosition()` again,
  // which itself calls `setCursorPosition({ line, col })` with a fresh object
  // — fresh object refs bypass React's bail-out and feed the cycle.
  // The functional-update form bails out (returns the previous state) when the
  // values haven't actually changed, breaking the loop on idle re-renders.
  const handleCursorChange = useCallback((line: number, col: number) => {
    setCursorPosition((prev) => (prev.line === line && prev.col === col ? prev : { line, col }));
  }, []);
  // Bail out via functional update when the range hasn't actually changed —
  // selectionchange fires constantly while typing even when caret is at the
  // same offset, and we don't want to mint a fresh `{ start, end }` object
  // (and trigger a status-bar re-render) on every keystroke.
  const handleSelectionChange = useCallback((start: number, end: number) => {
    setSelectionRange((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);
  const handlePreviewLineChange = useCallback((line: number) => {
    setPreviewLine((prev) => (prev === line ? prev : line));
  }, []);

  // Handle image paste success
  const handleImagePaste = useCallback(() => {
    showToast('Image pasted successfully!', 'success');
  }, [showToast]);

  // Handle error messages from child components
  const handleError = useCallback((message: string) => {
    showToast(message, 'error');
  }, [showToast]);

  // Neutral info toast (distinct from error). Used e.g. when AI assist is
  // invoked before it's configured, so the action isn't a silent no-op.
  const handleNotice = useCallback((message: string) => {
    showToast(message, 'info');
  }, [showToast]);

  // Stable export-result callbacks so TitleBar's props are reference-equal
  // across renders. Inline arrows here would re-create the closures on every
  // App render and defeat any downstream memoization.
  const handleExportSuccess = useCallback(
    (fmt: string) => showToast(`Exported as ${fmt}`, "success"),
    [showToast]
  );
  const handleExportError = useCallback(
    (fmt: string) => showToast(`Failed to export ${fmt}`, "error"),
    [showToast]
  );

  // App-wide keyboard shortcuts (window-level, mounted once). See the hook.
  useGlobalShortcuts({
    handleOpenFile, handleSaveFile, handleSaveAs, handleNewFile,
    handleToggleMode, handleToggleSplit, handleToggleFileExplorer, handleToggleTOC,
    openCheatsheet: () => setShowCheatsheet(true),
    openPalette: () => setShowPalette(true),
    openSettings: () => setShowSettings(true),
    // Ctrl+F in reader mode opens the preview find bar (the editor keymap
    // handles find in code/split mode, where the editor has focus). FIND-01.
    openPreviewFind: () => setPreviewFindOpen(true),
    hasFile, content, mode,
  });

  // Get export HTML from the visible preview on demand (avoids duplicate rendering)
  const getExportHtml = useCallback((): string => {
    if (previewRef.current) {
      return previewRef.current.innerHTML;
    }
    return "";
  }, []);

  // Build the command palette item list. Rebuilds on relevant state changes —
  // recent files, current file, current view mode, toggles.
  const paletteItems = useMemo<PaletteCommand[]>(() => {
    const items: PaletteCommand[] = [];

    // === File ===
    items.push({
      id: "file.new",
      label: "New file",
      hint: "Ctrl+N",
      section: "File",
      icon: "edit_note",
      run: handleNewFile,
    });
    items.push({
      id: "file.open",
      label: "Open file…",
      hint: "Ctrl+O",
      section: "File",
      icon: "folder_open",
      run: handleOpenFile,
    });
    // Save / Save As only make sense when a buffer is open
    if (hasFile) {
      items.push({
        id: "file.save",
        label: "Save",
        hint: "Ctrl+S",
        section: "File",
        icon: "save",
        run: handleSaveFile,
      });
      items.push({
        id: "file.saveas",
        label: "Save As…",
        hint: "Ctrl+Shift+S",
        section: "File",
        icon: "save_as",
        run: handleSaveAs,
      });
    }
    if (filePath) {
      items.push({
        id: "file.reveal",
        label: "Reveal in folder",
        section: "File",
        icon: "folder_open",
        keywords: "show finder explorer locate",
        run: () => {
          revealItemInDir(filePath).catch((err) => {
            console.error("Reveal failed:", err);
            showToast("Could not reveal file", "error");
          });
        },
      });
      items.push({
        id: "file.copypath",
        label: "Copy file path",
        section: "File",
        icon: "content_copy",
        keywords: "clipboard absolute",
        run: () => {
          navigator.clipboard.writeText(filePath).then(
            () => showToast("File path copied", "success"),
            () => showToast("Could not copy path", "error"),
          );
        },
      });
    }
    if (hasFile) {
      items.push({
        id: "doc.stats",
        label: "Show document statistics",
        section: "File",
        icon: "analytics",
        keywords: "words count reading time",
        run: () => setShowStats(true),
      });
    }

    // === View === only when a buffer exists
    if (hasFile) {
      items.push({
        id: "view.preview",
        label: "Switch to Reader mode",
        hint: "Ctrl+E",
        section: "View",
        icon: "visibility",
        run: () => setMode("preview"),
      });
      items.push({
        id: "view.code",
        label: "Switch to Code editor",
        section: "View",
        icon: "code",
        run: () => setMode("code"),
      });
      items.push({
        id: "view.split",
        label: "Toggle Split view",
        hint: "Ctrl+\\",
        section: "View",
        icon: "vertical_split",
        run: handleToggleSplit,
      });
      items.push({
        id: "view.explorer",
        label: "Toggle file explorer",
        hint: "Ctrl+Shift+E",
        section: "View",
        icon: "folder",
        run: handleToggleFileExplorer,
      });
      items.push({
        id: "view.toc",
        label: "Toggle outline",
        hint: "Ctrl+Shift+O",
        section: "View",
        icon: "format_list_bulleted",
        run: handleToggleTOC,
      });
    }

    // === AI === only when a buffer exists and AI is enabled in Settings.
    // The command palette is the always-reachable entry point for AI assist
    // (the toolbar AI button is hidden when the toolbar is off). Dispatches a
    // window event the editor listens for; if AI isn't configured the editor
    // shows a guiding notice.
    if (hasFile && aiEnabled) {
      items.push({
        id: "ai.assist",
        label: "AI assist on selection",
        hint: AI_SHORTCUT,
        section: "AI",
        icon: "auto_awesome",
        keywords: "ai rewrite shorten expand continue translate assistant gpt llm",
        run: () => window.dispatchEvent(new CustomEvent("paperling:ai-assist")),
      });
    }

    // === Toggles ===
    items.push({
      id: "toggle.typewriter",
      label: typewriterModeEnabled ? "Disable Typewriter mode" : "Enable Typewriter mode",
      section: "Toggles",
      icon: "keyboard",
      keywords: "scroll caret center",
      run: () => setTypewriterModeEnabled((v) => !v),
    });
    items.push({
      id: "toggle.toolbar",
      label: toolbarVisible ? "Hide formatting toolbar" : "Show formatting toolbar",
      section: "Toggles",
      icon: "format_paint",
      run: () => setToolbarVisible((v) => !v),
    });

    items.push({
      id: "settings.open",
      label: "Open Settings…",
      hint: "Ctrl+,",
      section: "Toggles",
      icon: "settings",
      run: () => setShowSettings(true),
    });

    // === Help ===
    items.push({
      id: "help.cheatsheet",
      label: "Show keyboard shortcuts",
      hint: "?",
      section: "Help",
      icon: "keyboard",
      run: () => setShowCheatsheet(true),
    });
    items.push({
      id: "help.tour",
      label: "Replay the welcome tour",
      section: "Help",
      icon: "tour",
      keywords: "onboarding intro guide help walkthrough",
      run: () => {
        // The tour spotlights editor chrome, so make sure a buffer exists first.
        if (!hasFile) handleNewFile();
        setShowTour(true);
      },
    });

    // === Recent files ===
    const recents = getRecentFiles();
    for (const r of recents) {
      if (r.path === filePath) continue; // current file
      items.push({
        id: `recent.${r.path}`,
        label: r.name,
        hint: r.path,
        section: "Recent files",
        icon: "description",
        keywords: r.path,
        run: () => loadFile(r.path),
      });
    }

    return items;
  }, [
    // NB: deferredContent is intentionally NOT a dep here. Building static
    // file/view/toggle/recent items doesn't depend on the document text, so
    // letting `content` flow into this useMemo would rebuild every keystroke
    // (post-debounce) for no reason. Headings are computed below in a
    // separate hook that's gated on the palette actually being open.
    handleNewFile, handleOpenFile, handleSaveFile, handleSaveAs,
    handleToggleSplit, handleToggleFileExplorer, handleToggleTOC,
    loadFile, filePath, hasFile, showToast,
    typewriterModeEnabled, toolbarVisible, aiEnabled,
  ]);

  // Heading items are recomputed only while the palette is actually open.
  // Scanning every line of the document for `#`-prefixed headings on every
  // typing pause used to be cheap on small docs and noticeable on large
  // ones — and 100 % of that work was discarded if the user wasn't looking
  // at the palette.
  const headingPaletteItems = useMemo<PaletteCommand[]>(() => {
    if (!showPalette || !deferredContent) return [];
    const items: PaletteCommand[] = [];
    const lines = deferredContent.split("\n");
    lines.forEach((line, idx) => {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (m) {
        const level = m[1].length;
        const text = m[2].trim();
        items.push({
          id: `head.${idx}`,
          label: text,
          hint: `H${level}`,
          section: "Headings",
          icon: level === 1 ? "title" : level === 2 ? "format_h2" : "format_h3",
          keywords: "jump heading",
          run: () => {
            // Jump both panes to the heading's source line. The editor and the
            // preview each listen for this event and scroll themselves (hidden
            // panes scroll harmlessly), so this works in every view mode and
            // lands on the RIGHT heading even when titles repeat. NAV-01.
            window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line: idx + 1 } }));
          },
        });
      }
    });
    return items;
  }, [showPalette, deferredContent]);

  // Concatenated list passed to the palette. Same `paletteItems` shape as
  // before so the CommandPalette component sees no API change. Reference
  // changes only when one of the two sources changes — typically rare.
  const fullPaletteItems = useMemo<PaletteCommand[]>(
    () => (headingPaletteItems.length ? [...paletteItems, ...headingPaletteItems] : paletteItems),
    [paletteItems, headingPaletteItems]
  );

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] overflow-hidden transition-colors">
      <TitleBar
        fileName={fileName ?? undefined}
        isDirty={isDirty}
        filePath={filePath ?? undefined}
        onOpenFile={handleOpenFile}
        onNewFile={handleNewFile}
        getExportHtml={getExportHtml}
        onExportSuccess={handleExportSuccess}
        onExportError={handleExportError}
        onToggleAI={aiEnabled ? handleToggleAI : undefined}
        aiActive={showAIPanel}
      />

      {/* Startup update check; invisible unless an update is actually available. */}
      <Suspense fallback={null}>
        <UpdateDialog />
      </Suspense>

      {!hasFile ? (
        booting ? (
          // Neutral splash while the last-opened file is being restored — avoids
          // a one-frame WelcomeScreen flash before the editor mounts.
          <div className="flex-1 flex items-center justify-center bg-[var(--bg-primary)]">
            <span className="material-symbols-outlined text-[28px] text-[var(--text-muted)] animate-spin">progress_activity</span>
          </div>
        ) : (
          <WelcomeScreen
            onOpenFile={handleOpenFile}
            onNewFile={handleNewFile}
            onOpenSettings={() => setShowSettings(true)}
            onFileDrop={handleFileDrop}
            onOpenRecent={loadFile}
          />
        )
      ) : (
        <>
          {/* Split-aware layout. Both views always mounted; CSS toggles their display
              and width so editor/preview state (scroll, selection) is preserved across
              mode switches. */}
          <div
            ref={splitContainerRef}
            data-tour="editor"
            className="flex-1 overflow-hidden flex flex-row"
            // Reserve space on the right for the AI panel so editor/preview reflow
            // beside it instead of being covered. The panel itself is fixed at
            // right-0 (above the status bar), which keeps window controls at the edge.
            // min() mirrors the panel's own w-[400px] max-w-[90vw] so a narrow
            // window reserves only as much space as the panel actually takes.
            style={{ paddingRight: showAIPanel ? `min(${AI_PANEL_WIDTH}px, 90vw)` : 0, transition: "padding-right 0.15s ease" }}
          >
            <div
              data-split-left
              className="overflow-hidden flex flex-col"
              style={{
                display: mode === "code" || mode === "split" ? "flex" : "none",
                flexBasis: mode === "split" ? `${splitRatio * 100}%` : "100%",
                flexGrow: mode === "split" ? 0 : 1,
                flexShrink: 0,
                minWidth: 0,
              }}
            >
              <CodeEditor
                content={content}
                onChange={handleContentChange}
                onCursorChange={handleCursorChange}
                onSelectionChange={handleSelectionChange}
                onImagePaste={handleImagePaste}
                onError={handleError}
                onNotice={handleNotice}
                filePath={filePath}
                onScrollFraction={onCodeScrollFraction}
                registerScroller={registerCodeScroller}
                typewriterMode={typewriterModeEnabled}
                showToolbar={toolbarVisible}
                wordWrap={wordWrapEnabled}
                spellCheck={spellCheckEnabled}
                aiConfig={aiConfig}
                reviewDoc={proposedDoc}
                onReviewResolve={handleReviewResolve}
              />
            </div>

            {mode === "split" && (
              <SplitDivider onDrag={setSplitRatioState} containerRef={splitContainerRef} />
            )}

            <div
              className="overflow-hidden flex flex-col relative"
              style={{
                display: mode === "preview" || mode === "split" ? "flex" : "none",
                flexBasis: mode === "split" ? `${(1 - splitRatio) * 100}%` : "100%",
                flexGrow: mode === "split" ? 0 : 1,
                flexShrink: 0,
                minWidth: 0,
              }}
            >
              {/* MarkdownPreview is lazy-loaded — its react-markdown +
                  remark-gfm + rehype-highlight stack is ~250 kB and
                  doesn't need to ship with the welcome screen. The
                  fallback is invisible since the parent column already
                  has a background; a brief flash on first render is
                  preferable to a spinner that pre-empts the layout. */}
              <Suspense fallback={null}>
                <MarkdownPreview
                  content={deferredContent}
                  fileName={fileName || ""}
                  fileSize={fileSize}
                  onEditClick={handleToggleMode}
                  onLineChange={handlePreviewLineChange}
                  filePath={filePath}
                  markdownBodyRef={previewRef}
                  onContentChange={handleContentChange}
                  onScrollFraction={onPreviewScrollFraction}
                  registerScroller={registerPreviewScroller}
                  onWikilinkClick={handleWikilinkClick}
                />
              </Suspense>

              {/* Reader-mode find. Searches the rendered preview text and
                  highlights matches via the CSS Custom Highlight API. */}
              {previewFindOpen && (
                <PreviewFindBar
                  rootRef={previewRef}
                  onClose={() => setPreviewFindOpen(false)}
                />
              )}
            </div>
          </div>

          <ModeToggle mode={mode} onSetMode={setMode} aiPanelOpen={showAIPanel} />

          {/* Sidebar Panels — only mount when actually open so they don't
              load their module until first use. */}
          {showFileExplorer && (
            <Suspense fallback={null}>
              <FileExplorer
                isOpen={showFileExplorer}
                currentFilePath={filePath}
                onFileSelect={loadFile}
                onClose={closeAllPanels}
              />
            </Suspense>
          )}
          {showTOC && (
            <Suspense fallback={null}>
              <TableOfContents
                isOpen={showTOC}
                content={deferredContent}
                onClose={closeAllPanels}
                activeLine={mode === "preview" ? previewLine : cursorPosition.line}
              />
            </Suspense>
          )}

          {/* Right-side AI assistant panel. Reads the live document + current
              selection; chat is read-only for now (edit/agent flow is next). */}
          {aiEnabled && showAIPanel && (
            <Suspense fallback={null}>
              <AIPanel
                isOpen={showAIPanel}
                onClose={() => setShowAIPanel(false)}
                note={content}
                fileName={fileName || ""}
                selectionText={content.slice(selectionRange.start, selectionRange.end)}
                aiConfig={aiConfig}
                onProposeEdit={handleProposeEdit}
              />
            </Suspense>
          )}

<StatusBar
            isSaved={!isDirty}
            lineNumber={mode === "preview" ? previewLine : cursorPosition.line}
            columnNumber={cursorPosition.col}
            mode={mode}
            showFileExplorer={showFileExplorer}
            showTOC={showTOC}
            onToggleFileExplorer={handleToggleFileExplorer}
            onToggleTOC={handleToggleTOC}
            wordCount={wordCount}
            charCount={charCount}
            readingTimeMin={readingTimeMin}
            selectionLength={mode !== "preview" ? selectionLength : 0}
            selectionWordCount={selectionWordCount}
          />
        </>
      )}

      {/* Unsaved-changes dialog: only mounts when needed. Most app sessions
          never trigger it, so eagerly loading the module was pure waste. */}
      {showUnsavedBeforeOpen && (
        <Suspense fallback={null}>
          <UnsavedChangesDialog
            isOpen={showUnsavedBeforeOpen}
            onClose={handleCancelOpen}
            onDiscard={handleDiscardAndOpen}
            onSave={handleSaveAndOpen}
          />
        </Suspense>
      )}

      {/* Unsaved-changes dialog for window close — fed by the Tauri
          close-requested interception above, so it covers Alt+F4 and the
          taskbar close, not just the title bar X. */}
      {showUnsavedBeforeClose && (
        <Suspense fallback={null}>
          <UnsavedChangesDialog
            isOpen={showUnsavedBeforeClose}
            onClose={() => setShowUnsavedBeforeClose(false)}
            onDiscard={handleDiscardAndCloseWindow}
            onSave={handleSaveAndCloseWindow}
          />
        </Suspense>
      )}

      {/* Loading overlay */}
      {isLoading && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[var(--bg-primary)]/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3">
            <span className="material-symbols-outlined text-[32px] text-[var(--accent)] animate-spin">progress_activity</span>
            <span className="text-sm text-[var(--text-secondary)]">Loading...</span>
          </div>
        </div>
      )}

      {/* Heavy modal surfaces — palette, settings, stats, cheatsheet — are
          off the cold-start critical path. They mount only when first
          opened so their bundles only download on demand. */}
      {showCheatsheet && (
        <Suspense fallback={null}>
          <ShortcutCheatsheet isOpen={showCheatsheet} onClose={() => setShowCheatsheet(false)} />
        </Suspense>
      )}
      {/* Stats dialog reads LIVE `content`, not the debounced version. The
          dialog opens on a discrete user action (palette command), not while
          typing, so the typing-fast-path argument doesn't apply — and a user
          who opens "Show document statistics" expects the numbers to match
          what they just typed. */}
      {showStats && (
        <Suspense fallback={null}>
          <StatsDialog isOpen={showStats} content={content} onClose={() => setShowStats(false)} />
        </Suspense>
      )}
      {showPalette && (
        <Suspense fallback={null}>
          <CommandPalette isOpen={showPalette} items={fullPaletteItems} onClose={() => setShowPalette(false)} />
        </Suspense>
      )}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={showSettings}
            onClose={() => {
              setShowSettings(false);
              setAiConfigState(getAIConfig()); // pick up endpoint/key edits immediately
            }}
          />
        </Suspense>
      )}

      {/* First-run welcome tour. Gated on hasFile because every spotlight
          target (editor panes, mode toggle) only exists with an open buffer. */}
      {showTour && hasFile && !booting && (
        <Tour onClose={handleCloseTour} onSetMode={setMode} />
      )}

      {/* Toast notifications */}
      <Toast
        message={toast.message}
        isVisible={toast.isVisible}
        onHide={hideToast}
        type={toast.type}
      />
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  );
}

export default App;
