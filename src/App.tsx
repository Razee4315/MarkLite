import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen, TauriEvent } from "@tauri-apps/api/event";

import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { ThemeProvider } from "./context/ThemeContext";
import { TitleBar } from "./components/TitleBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { CodeEditor } from "./components/CodeEditor";
import { StatusBar } from "./components/StatusBar";
import { ModeToggle, type ViewMode } from "./components/ModeToggle";
import { Toast, ToastType } from "./components/Toast";
import { SplitDivider } from "./components/SplitDivider";
import { createScrollSync } from "./utils/scrollSync";
import { type PaletteCommand } from "./components/CommandPalette";

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
import { getRecentFiles } from "./utils/persistence";
import {
  addRecentFile,
  getAIConfig,
  getLastFile,
  getSavedViewMode,
  getSpellCheck,
  getSplitRatio,
  getToolbarEnabled,
  getTypewriterMode,
  getWordWrap,
  setLastFile,
  setSavedViewMode,
  setSpellCheck,
  setSplitRatio,
  setToolbarEnabled,
  setTypewriterMode,
  setWordWrap,
} from "./utils/persistence";

interface FileData {
  path: string;
  name: string;
  content: string;
  size: number;
  line_count: number;
}

// Utility function to count words in text
const getWordCount = (text: string): number => {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
};

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
  const [showStats, setShowStats] = useState(false);
  const [splitRatio, setSplitRatioState] = useState<number>(() => getSplitRatio());
  const [aiConfig, setAiConfigState] = useState(() => getAIConfig());
  const [typewriterModeEnabled, setTypewriterModeEnabled] = useState<boolean>(() => getTypewriterMode());
  const [toolbarVisible, setToolbarVisible] = useState<boolean>(() => getToolbarEnabled());
  const [wordWrapEnabled, setWordWrapEnabled] = useState<boolean>(() => getWordWrap());
  const [spellCheckEnabled, setSpellCheckEnabled] = useState<boolean>(() => getSpellCheck());
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  // Editor selection range. Collapsed (start === end) means no selection;
  // when start < end we surface a "N words selected" chip in the status bar.
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const [isLoading, setIsLoading] = useState(false);

  // Pending file to open after unsaved changes dialog
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const [showUnsavedBeforeOpen, setShowUnsavedBeforeOpen] = useState(false);

  // Sidebar panel state
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [showTOC, setShowTOC] = useState(false);

  // Preview scroll position
  const [previewLine, setPreviewLine] = useState(1);

  // Toast notification state
  const [toast, setToast] = useState<{ message: string; isVisible: boolean; type: ToastType }>({ message: '', isVisible: false, type: 'success' });

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
  const deferredContent = useDebouncedValue(content, 80);

  const lineCount = useMemo(() => content.split("\n").length, [content]);
  // Word/char counts feed the status bar — fine to lag a frame behind on huge
  // docs, so they read deferred too.
  const wordCount = useMemo(() => getWordCount(deferredContent), [deferredContent]);
  const charCount = deferredContent.length;
  // Selection word count, when the user has a non-empty range highlighted.
  // Reads LIVE `content` (not deferredContent) since the selection range and
  // the underlying text must agree — sliding by 80ms would briefly count words
  // from a stale buffer right after a fast edit. The slice is cheap regardless.
  const selectionLength = selectionRange.end - selectionRange.start;
  const selectionWordCount = useMemo(
    () => (selectionLength > 0 ? getWordCount(content.slice(selectionRange.start, selectionRange.end)) : 0),
    [content, selectionRange.start, selectionRange.end, selectionLength]
  );
  // Average adult reading speed for prose: ~200 wpm.
  const readingTimeMin = useMemo(() => wordCount / 200, [wordCount]);

  // Show toast helper
  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    setToast({ message, isVisible: true, type });
  }, []);

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

  // Cross-component event listeners — settings menu and command palette toggle these
  useEffect(() => {
    const handlers: Array<[string, (e: Event) => void]> = [
      ["marklite:typewriter-toggle", (e) => setTypewriterModeEnabled(!!(e as CustomEvent).detail?.enabled)],
      ["marklite:toolbar-toggle", (e) => setToolbarVisible(!!(e as CustomEvent).detail?.enabled)],
      ["marklite:wordwrap-toggle", (e) => setWordWrapEnabled(!!(e as CustomEvent).detail?.enabled)],
      ["marklite:spellcheck-toggle", (e) => setSpellCheckEnabled(!!(e as CustomEvent).detail?.enabled)],
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

  useEffect(() => {
    // Restore last opened file once on app launch
    const last = getLastFile();
    if (last) {
      // Fire-and-forget; failures are mostly silent (file may have been moved
      // / deleted), but we DO surface a toast for the new TooLarge case so a
      // user who suddenly can't reopen yesterday's file isn't left guessing.
      invoke<FileData>("read_file", { path: last })
        .then((fileData) => {
          setFilePath(fileData.path);
          setFileName(fileData.name);
          setContent(fileData.content);
          setOriginalContent(fileData.content);
          setFileSize(fileData.size);
          // Bump the recents entry's timestamp to "now" so it sorts as
          // most-recent. Previously the restored file kept the stale openedAt
          // from whenever it was originally opened, which made the welcome
          // screen show "3d ago" for the file you'd just been editing.
          addRecentFile(fileData.path, fileData.name);
        })
        .catch((err) => {
          setLastFile(null);
          const msg = typeof err === "string" ? err : (err as { message?: string })?.message || "";
          if (/too large/i.test(msg)) {
            showToast(`Could not restore last file: ${msg}`, "error");
          }
        });
    }
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
        await invoke("save_file", { path: filePath, content });
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
      await invoke("save_file", { path: selected, content });
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
      await invoke("save_file", { path: filePath, content });
      setOriginalContent(content);
      showToast("File saved", "success");
    } catch (err) {
      console.error("Failed to save file:", err);
      const msg = typeof err === "string" ? err : (err as { message?: string })?.message;
      showToast(msg || "Failed to save file", "error");
    }
  }, [filePath, content, showToast, handleSaveAs]);

  // Listen for file open from CLI (when app is opened with a file by double-click)
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

  // Hide toast
  const hideToast = useCallback(() => {
    // Bail out when the toast is already hidden — without this guard, a
    // duplicate hide call (e.g. from a quick second toast cancelling the
    // first) allocates a fresh object even though `isVisible: false` was
    // already true, triggering a Toast re-render that schedules a fresh
    // pair of fade/hide timers.
    setToast(prev => prev.isVisible ? { ...prev, isVisible: false } : prev);
  }, []);

  // Keyboard shortcuts
  // Keyboard shortcut handler. Mounted once on app start; reads the latest
  // values for handlers + hasFile/content via a ref so the listener doesn't
  // need to be removed and re-added on every keystroke (which the previous
  // dep-array form did because `content` was listed as a dep).
  const shortcutsRef = useRef({
    handleOpenFile, handleSaveFile, handleSaveAs, handleNewFile,
    handleToggleMode, handleToggleSplit, handleToggleFileExplorer, handleToggleTOC,
    hasFile, content,
  });
  shortcutsRef.current = {
    handleOpenFile, handleSaveFile, handleSaveAs, handleNewFile,
    handleToggleMode, handleToggleSplit, handleToggleFileExplorer, handleToggleTOC,
    hasFile, content,
  };
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const s = shortcutsRef.current;
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
      // Ctrl+O - Open file (without Shift)
      if (e.ctrlKey && !e.shiftKey && e.key === "o") {
        e.preventDefault();
        s.handleOpenFile();
      }
      // Ctrl+S - Save file
      if (e.ctrlKey && !e.shiftKey && e.key === "s") {
        e.preventDefault();
        if (s.hasFile || s.content) s.handleSaveFile();
      }
      // Ctrl+Shift+S - Save As
      if (e.ctrlKey && e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (s.hasFile || s.content) s.handleSaveAs();
      }
      // Ctrl+N - New file
      if (e.ctrlKey && !e.shiftKey && e.key === "n") {
        e.preventDefault();
        s.handleNewFile();
      }
      // Ctrl+E - Toggle preview/code mode (without Shift)
      if (e.ctrlKey && !e.shiftKey && e.key === "e") {
        e.preventDefault();
        if (s.hasFile) s.handleToggleMode();
      }
      // Ctrl+\ - Toggle split view
      if (e.ctrlKey && !e.shiftKey && e.key === "\\") {
        e.preventDefault();
        if (s.hasFile) s.handleToggleSplit();
      }
      // ? — Show cheatsheet (only when no input is focused)
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const target = e.target as HTMLElement | null;
        const isTyping = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (!isTyping) {
          e.preventDefault();
          setShowCheatsheet(true);
        }
      }
      // Ctrl+P / Ctrl+Shift+P — command palette
      if ((e.ctrlKey || e.metaKey) && (e.key === "p" || e.key === "P")) {
        e.preventDefault();
        setShowPalette(true);
      }
      // Ctrl+, — Settings
      if ((e.ctrlKey || e.metaKey) && e.key === ",") {
        e.preventDefault();
        setShowSettings(true);
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

    // === Headings of current document ===
    // Use deferredContent so a single keystroke doesn't re-scan every line for
    // headings. The palette is closed most of the time anyway.
    if (deferredContent) {
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
              // Switch to preview if in code-only mode, then scroll to heading
              setMode((prev) => (prev === "code" ? "preview" : prev));
              requestAnimationFrame(() => {
                const slug = text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-").replace(/-+/g, "-");
                const el = document.getElementById(slug);
                el?.scrollIntoView({ behavior: "smooth", block: "start" });
              });
            },
          });
        }
      });
    }

    return items;
  }, [
    handleNewFile, handleOpenFile, handleSaveFile, handleSaveAs,
    handleToggleSplit, handleToggleFileExplorer, handleToggleTOC,
    loadFile, filePath, deferredContent, hasFile, showToast,
    typewriterModeEnabled, toolbarVisible,
  ]);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] overflow-hidden transition-colors">
      <TitleBar
        fileName={fileName ?? undefined}
        isDirty={isDirty}
        filePath={filePath ?? undefined}
        onOpenFile={handleOpenFile}
        onNewFile={handleNewFile}
        onSaveFile={handleSaveFile}
        getExportHtml={getExportHtml}
        onExportSuccess={(fmt) => showToast(`Exported as ${fmt}`, "success")}
        onExportError={(fmt) => showToast(`Failed to export ${fmt}`, "error")}
      />

      {!hasFile ? (
        <WelcomeScreen
          onOpenFile={handleOpenFile}
          onNewFile={handleNewFile}
          onOpenSettings={() => setShowSettings(true)}
          onFileDrop={handleFileDrop}
          onOpenRecent={loadFile}
        />
      ) : (
        <>
          {/* Split-aware layout. Both views always mounted; CSS toggles their display
              and width so editor/preview state (scroll, selection) is preserved across
              mode switches. */}
          <div ref={splitContainerRef} className="flex-1 overflow-hidden flex flex-row">
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
                filePath={filePath}
                onScrollFraction={onCodeScrollFraction}
                registerScroller={registerCodeScroller}
                typewriterMode={typewriterModeEnabled}
                showToolbar={toolbarVisible}
                wordWrap={wordWrapEnabled}
                spellCheck={spellCheckEnabled}
                aiConfig={aiConfig}
              />
            </div>

            {mode === "split" && (
              <SplitDivider onDrag={setSplitRatioState} containerRef={splitContainerRef} />
            )}

            <div
              className="overflow-hidden flex flex-col"
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
                  lineCount={lineCount}
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
            </div>
          </div>

          <ModeToggle mode={mode} onSetMode={setMode} />

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
          <CommandPalette isOpen={showPalette} items={paletteItems} onClose={() => setShowPalette(false)} />
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
