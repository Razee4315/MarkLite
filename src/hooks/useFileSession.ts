import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import type { ViewMode } from "../components/ModeToggle";
import type { ToastType } from "./useToast";
import { useAutosave } from "./useAutosave";
import { useExternalChangeWatcher } from "./useExternalChangeWatcher";
import { errMessage } from "../utils/errors";
import {
  addRecentFile,
  getLastFile,
  getOpenInReader,
  getSession,
  setLastFile,
  setSession,
} from "../utils/persistence";
import {
  collectDirtyTabs as computeDirtyTabs,
  findReusableUntitledTab,
  findTabByPath,
  moveTab,
  nextActiveAfterClose,
  nextUntitledName,
  type DirtyTab,
  type TabState,
} from "../utils/tabsModel";

interface FileData {
  path: string;
  name: string;
  content: string;
  size: number;
  line_count: number;
  modified: number;
}

type ShowToast = (message: string, type?: ToastType) => void;

export interface UseFileSessionOptions {
  currentLine: number;
  autoSaveEnabled: boolean;
  isReviewActive: boolean;
  clearReview: () => void;
  setMode: Dispatch<SetStateAction<ViewMode>>;
  showToast: ShowToast;
  /** Tests can disable launch restoration without changing production behavior. */
  restoreOnMount?: boolean;
}

// React StrictMode remounts effects in development. Keep launch-file resolution
// module-scoped so the backend's take-once CLI path cannot race session restore.
let bootResolved = false;

export function useFileSession({
  currentLine,
  autoSaveEnabled,
  isReviewActive,
  clearReview,
  setMode,
  showToast,
  restoreOnMount = true,
}: UseFileSessionOptions) {
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [docSwapId, setDocSwapId] = useState(0);
  const [booting, setBooting] = useState(restoreOnMount);
  const [isLoading, setIsLoading] = useState(false);
  const [closeTabPrompt, setCloseTabPrompt] = useState<{ id: string; fileName: string } | null>(null);

  const tabSeqRef = useRef(0);
  const tabsRef = useRef<TabState[]>([]);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = activeTabId;
  const closedTabsRef = useRef<{ path: string; cursorLine?: number }[]>([]);
  const liveRef = useRef({ filePath, fileName, content, originalContent, fileSize });
  liveRef.current = { filePath, fileName, content, originalContent, fileSize };
  const currentLineRef = useRef(1);
  currentLineRef.current = currentLine;
  const knownMtimeRef = useRef(0);
  const contentRef = useRef(content);
  contentRef.current = content;
  const originalContentRef = useRef(originalContent);
  originalContentRef.current = originalContent;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const reviewActiveRef = useRef(isReviewActive);
  reviewActiveRef.current = isReviewActive;

  const isDirty = content !== originalContent;
  const hasFile = filePath !== null || fileName !== null;

  const bumpDocSwap = useCallback(() => setDocSwapId((n) => n + 1), []);
  const commitTabs = useCallback((next: TabState[]) => {
    tabsRef.current = next;
    setTabs(next);
  }, []);
  const setActiveTab = useCallback((id: string | null) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
  }, []);
  const newTabId = useCallback(() => `tab-${++tabSeqRef.current}`, []);

  const collectDirtyTabs = useCallback(
    (): DirtyTab[] => computeDirtyTabs(tabsRef.current, activeTabIdRef.current, liveRef.current),
    [],
  );

  const snapshotActiveTab = useCallback(() => {
    const id = activeTabIdRef.current;
    if (!id) return;
    const live = liveRef.current;
    commitTabs(
      tabsRef.current.map((tab) =>
        tab.id === id
          ? {
              ...tab,
              filePath: live.filePath,
              fileName: live.fileName ?? "Untitled.md",
              content: live.content,
              originalContent: live.originalContent,
              fileSize: live.fileSize,
              knownMtime: knownMtimeRef.current,
              cursorLine: currentLineRef.current,
            }
          : tab,
      ),
    );
  }, [commitTabs]);

  const applyTabToLive = useCallback(
    (tab: TabState) => {
      clearReview();
      bumpDocSwap();
      setFilePath(tab.filePath);
      setFileName(tab.fileName);
      setContent(tab.content);
      setOriginalContent(tab.originalContent);
      setFileSize(tab.fileSize);
      knownMtimeRef.current = tab.knownMtime;
      if (tab.filePath) setLastFile(tab.filePath);
      const line = tab.cursorLine ?? 1;
      requestAnimationFrame(() => {
        if (line > 1) window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line } }));
        else window.dispatchEvent(new CustomEvent("paperling:scroll-top"));
      });
    },
    [bumpDocSwap, clearReview],
  );

  const activateTab = useCallback(
    (id: string) => {
      if (id === activeTabIdRef.current) return;
      snapshotActiveTab();
      const target = tabsRef.current.find((tab) => tab.id === id);
      if (!target) return;
      setActiveTab(id);
      applyTabToLive(target);
    },
    [applyTabToLive, setActiveTab, snapshotActiveTab],
  );

  const cycleTab = useCallback(
    (delta: number) => {
      const list = tabsRef.current;
      if (list.length < 2) return;
      const index = list.findIndex((tab) => tab.id === activeTabIdRef.current);
      if (index === -1) return;
      activateTab(list[(index + delta + list.length) % list.length].id);
    },
    [activateTab],
  );

  const loadFileDirect = useCallback(
    async (path: string) => {
      const outgoing = filePathRef.current;
      snapshotActiveTab();
      setIsLoading(true);
      try {
        const fileData = await invoke<FileData>("read_file", { path });
        bumpDocSwap();
        setFilePath(fileData.path);
        setFileName(fileData.name);
        setContent(fileData.content);
        setOriginalContent(fileData.content);
        setFileSize(fileData.size);
        knownMtimeRef.current = fileData.modified ?? 0;
        addRecentFile(fileData.path, fileData.name);
        setLastFile(fileData.path);
        const loaded = {
          filePath: fileData.path,
          fileName: fileData.name,
          content: fileData.content,
          originalContent: fileData.content,
          fileSize: fileData.size,
          knownMtime: fileData.modified ?? 0,
        };
        const existing = findTabByPath(tabsRef.current, fileData.path);
        if (existing) {
          commitTabs(tabsRef.current.map((tab) => (tab.id === existing.id ? { ...tab, ...loaded } : tab)));
          setActiveTab(existing.id);
        } else {
          const id = newTabId();
          commitTabs([...tabsRef.current, { id, ...loaded }]);
          setActiveTab(id);
        }
        if (outgoing !== fileData.path) {
          requestAnimationFrame(() => window.dispatchEvent(new CustomEvent("paperling:scroll-top")));
        }
        if (outgoing !== fileData.path && getOpenInReader()) setMode("preview");
      } catch (error) {
        console.error("Failed to load file:", error);
        showToast(errMessage(error) || "Failed to open file", "error");
      } finally {
        setIsLoading(false);
      }
    },
    [bumpDocSwap, commitTabs, newTabId, setActiveTab, setMode, showToast, snapshotActiveTab],
  );

  const loadFile = useCallback(
    async (path: string) => {
      const existing = findTabByPath(tabsRef.current, path);
      if (existing) {
        activateTab(existing.id);
        return;
      }
      await loadFileDirect(path);
    },
    [activateTab, loadFileDirect],
  );

  const reopenClosedTab = useCallback(() => {
    const entry = closedTabsRef.current.pop();
    if (!entry) return;
    loadFile(entry.path);
    if (entry.cursorLine && entry.cursorLine > 1) {
      const line = entry.cursorLine;
      window.setTimeout(
        () => window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line } })),
        150,
      );
    }
  }, [loadFile]);

  const gotoTabByIndex = useCallback(
    (index: number) => {
      const list = tabsRef.current;
      if (list.length === 0) return;
      const target = index === -1 ? list[list.length - 1] : list[index];
      if (target) activateTab(target.id);
    },
    [activateTab],
  );

  const finalizeCloseTab = useCallback(
    (id: string) => {
      const closing = tabsRef.current.find((tab) => tab.id === id);
      if (closing?.filePath) {
        const isActiveClosing = id === activeTabIdRef.current;
        closedTabsRef.current.push({
          path: closing.filePath,
          cursorLine: isActiveClosing ? currentLineRef.current : closing.cursorLine,
        });
        if (closedTabsRef.current.length > 25) closedTabsRef.current.shift();
      }
      const isActive = id === activeTabIdRef.current;
      const nextId = nextActiveAfterClose(tabsRef.current, id);
      const remaining = tabsRef.current.filter((tab) => tab.id !== id);
      commitTabs(remaining);
      if (!isActive) return;
      const target = nextId ? remaining.find((tab) => tab.id === nextId) : undefined;
      if (target) {
        setActiveTab(target.id);
        applyTabToLive(target);
      } else {
        setActiveTab(null);
        clearReview();
        bumpDocSwap();
        setFilePath(null);
        setFileName(null);
        setContent("");
        setOriginalContent("");
        setFileSize(0);
        knownMtimeRef.current = 0;
        setLastFile(null);
      }
    },
    [applyTabToLive, bumpDocSwap, clearReview, commitTabs, setActiveTab],
  );

  const closeTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((entry) => entry.id === id);
      if (!tab) return;
      const isActive = id === activeTabIdRef.current;
      const dirty = isActive
        ? liveRef.current.content !== liveRef.current.originalContent
        : tab.content !== tab.originalContent;
      if (dirty) {
        setCloseTabPrompt({
          id,
          fileName: isActive ? (liveRef.current.fileName ?? "Untitled.md") : tab.fileName,
        });
        return;
      }
      finalizeCloseTab(id);
    },
    [finalizeCloseTab],
  );

  const getTabSaveData = useCallback((id: string) => {
    const tab = tabsRef.current.find((entry) => entry.id === id);
    if (!tab) return null;
    const isActive = id === activeTabIdRef.current;
    const live = liveRef.current;
    return {
      filePath: isActive ? live.filePath : tab.filePath,
      fileName: isActive ? (live.fileName ?? "Untitled.md") : tab.fileName,
      content: isActive ? live.content : tab.content,
    };
  }, []);

  const handleSaveCloseTab = useCallback(async () => {
    const prompt = closeTabPrompt;
    if (!prompt) return;
    const data = getTabSaveData(prompt.id);
    if (!data) {
      setCloseTabPrompt(null);
      return;
    }
    let path = data.filePath;
    if (!path) {
      const selected = await save({
        filters: [{ name: "Markdown", extensions: ["md"] }],
        defaultPath: data.fileName,
      });
      if (!selected) return;
      path = selected;
    }
    try {
      await invoke("save_file", { path, content: data.content });
    } catch (error) {
      showToast(errMessage(error) || "Failed to save file", "error");
      return;
    }
    setCloseTabPrompt(null);
    finalizeCloseTab(prompt.id);
  }, [closeTabPrompt, finalizeCloseTab, getTabSaveData, showToast]);

  const handleDiscardCloseTab = useCallback(() => {
    const prompt = closeTabPrompt;
    setCloseTabPrompt(null);
    if (prompt) finalizeCloseTab(prompt.id);
  }, [closeTabPrompt, finalizeCloseTab]);

  const cancelCloseTab = useCallback(() => setCloseTabPrompt(null), []);

  const handleNewFile = useCallback(() => {
    const reusable = findReusableUntitledTab(tabsRef.current);
    if (reusable) {
      if (reusable.id !== activeTabIdRef.current) activateTab(reusable.id);
      setMode("code");
      return;
    }
    snapshotActiveTab();
    bumpDocSwap();
    const id = newTabId();
    const name = nextUntitledName(tabsRef.current);
    commitTabs([
      ...tabsRef.current,
      { id, filePath: null, fileName: name, content: "", originalContent: "", fileSize: 0, knownMtime: 0 },
    ]);
    setActiveTab(id);
    clearReview();
    setFilePath(null);
    setFileName(name);
    setContent("");
    setOriginalContent("");
    setFileSize(0);
    knownMtimeRef.current = 0;
    setLastFile(null);
    setMode("code");
  }, [activateTab, bumpDocSwap, clearReview, commitTabs, newTabId, setActiveTab, setMode, snapshotActiveTab]);

  const openTutorial = useCallback(
    (tutorialContent: string) => {
      const name = "Welcome to Paperling.md";
      const bytes = new TextEncoder().encode(tutorialContent).length;
      snapshotActiveTab();
      bumpDocSwap();
      const reusable = findReusableUntitledTab(tabsRef.current);
      const id = reusable ? reusable.id : newTabId();
      const entry: TabState = {
        id,
        filePath: null,
        fileName: name,
        content: tutorialContent,
        originalContent: tutorialContent,
        fileSize: bytes,
        knownMtime: 0,
      };
      commitTabs(
        reusable ? tabsRef.current.map((tab) => (tab.id === id ? entry : tab)) : [...tabsRef.current, entry],
      );
      setActiveTab(id);
      clearReview();
      setFilePath(null);
      setFileName(name);
      setContent(tutorialContent);
      setOriginalContent(tutorialContent);
      setFileSize(bytes);
      knownMtimeRef.current = 0;
      setLastFile(null);
      setMode("split");
    },
    [bumpDocSwap, clearReview, commitTabs, newTabId, setActiveTab, setMode, snapshotActiveTab],
  );

  const handleOpenFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [{ name: "Markdown & text", extensions: ["md", "markdown", "txt", "text"] }],
      });
      if (typeof selected === "string") await loadFile(selected);
      else if (Array.isArray(selected)) for (const path of selected) await loadFile(path);
    } catch (error) {
      console.error("Failed to open file dialog:", error);
    }
  }, [loadFile]);

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
      const activeId = activeTabIdRef.current;
      if (activeId) {
        commitTabs(
          tabsRef.current.map((tab) =>
            tab.id === activeId
              ? {
                  ...tab,
                  filePath: selected,
                  fileName: name,
                  content,
                  originalContent: content,
                  knownMtime: knownMtimeRef.current,
                }
              : tab,
          ),
        );
      }
      showToast("File saved", "success");
    } catch (error) {
      console.error("Failed to save file:", error);
      showToast(errMessage(error) || "Failed to save file", "error");
    }
  }, [commitTabs, content, fileName, showToast]);

  const handleSaveFile = useCallback(async () => {
    if (!filePath) {
      await handleSaveAs();
      return;
    }
    try {
      knownMtimeRef.current = await invoke<number>("save_file", { path: filePath, content });
      setOriginalContent(content);
      showToast("File saved", "success");
    } catch (error) {
      console.error("Failed to save file:", error);
      showToast(errMessage(error) || "Failed to save file", "error");
    }
  }, [content, filePath, handleSaveAs, showToast]);

  const handleExternalReloaded = useCallback(
    () => showToast("File changed on disk, reloaded the latest version", "info"),
    [showToast],
  );
  const handleExternalConflict = useCallback(
    () => showToast("This file changed on disk. Saving will overwrite those changes.", "error"),
    [showToast],
  );
  useExternalChangeWatcher({
    filePathRef,
    contentRef,
    originalContentRef,
    knownMtimeRef,
    isReviewActiveRef: reviewActiveRef,
    reload: loadFileDirect,
    onReloaded: handleExternalReloaded,
    onConflict: handleExternalConflict,
  });

  const handleAutosaved = useCallback((mtime: number, saved: string) => {
    knownMtimeRef.current = mtime;
    setOriginalContent(saved);
  }, []);
  const handleAutosaveError = useCallback((message: string) => showToast(message, "error"), [showToast]);
  useAutosave({
    enabled: autoSaveEnabled,
    filePath,
    content,
    originalContent,
    isReviewActive,
    onSaved: handleAutosaved,
    onError: handleAutosaveError,
  });

  useEffect(() => {
    if (!autoSaveEnabled) return;
    const activeId = activeTabIdRef.current;
    const dirtyBackgroundTabs = tabs.filter(
      (tab) => tab.id !== activeId && tab.filePath && tab.content !== tab.originalContent,
    );
    if (dirtyBackgroundTabs.length === 0) return;
    const timer = window.setTimeout(async () => {
      for (const tab of dirtyBackgroundTabs) {
        try {
          const mtime = await invoke<number>("save_file", { path: tab.filePath!, content: tab.content });
          commitTabs(
            tabsRef.current.map((current) =>
              current.id === tab.id && current.content === tab.content
                ? { ...current, originalContent: tab.content, knownMtime: mtime }
                : current,
            ),
          );
        } catch {
          // Best effort; active-tab saves surface disk errors.
        }
      }
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [autoSaveEnabled, commitTabs, tabs]);

  useEffect(() => {
    const onFocus = async () => {
      const activeId = activeTabIdRef.current;
      const backgroundTabs = tabsRef.current.filter((tab) => tab.id !== activeId && tab.filePath);
      for (const tab of backgroundTabs) {
        try {
          const info = await invoke<{ modified: number }>("get_file_info", { path: tab.filePath! });
          if (!(tab.knownMtime > 0 && info.modified > tab.knownMtime)) continue;
          if (tab.content === tab.originalContent) {
            const fileData = await invoke<FileData>("read_file", { path: tab.filePath! });
            commitTabs(
              tabsRef.current.map((current) =>
                current.id === tab.id
                  ? {
                      ...current,
                      content: fileData.content,
                      originalContent: fileData.content,
                      fileSize: fileData.size,
                      knownMtime: fileData.modified ?? 0,
                    }
                  : current,
              ),
            );
          } else {
            commitTabs(
              tabsRef.current.map((current) =>
                current.id === tab.id ? { ...current, knownMtime: info.modified } : current,
              ),
            );
            showToast(
              `"${tab.fileName}" changed on disk in a background tab. Saving it will overwrite those changes.`,
              "error",
            );
          }
        } catch {
          // Missing files and stat failures are surfaced when the tab is saved.
        }
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [commitTabs, showToast]);

  useEffect(() => {
    // The boot effect reads the saved session later in this same effect phase.
    // Do not clear it from the initial empty tab state before restore runs.
    if (booting) return;
    const activeId = activeTabIdRef.current;
    const persistable = tabs.filter((tab) => tab.filePath);
    if (persistable.length === 0) {
      setSession(null);
      return;
    }
    const sessionTabs = persistable.map((tab) => ({
      path: tab.filePath!,
      cursorLine: tab.id === activeId ? currentLineRef.current : tab.cursorLine,
    }));
    const activeIndex = persistable.findIndex((tab) => tab.id === activeId);
    setSession({ tabs: sessionTabs, activeIndex: activeIndex < 0 ? 0 : activeIndex });
  }, [activeTabId, booting, tabs]);

  useEffect(() => {
    if (!restoreOnMount) {
      setBooting(false);
      return;
    }
    if (bootResolved) return;
    bootResolved = true;
    void (async () => {
      let cliFile: string | null = null;
      try {
        cliFile = await invoke<string | null>("get_cli_file");
      } catch {
        // Browser development mode or an older backend: restore only.
      }
      const session = getSession();
      const cursorByPath = new Map<string, number | undefined>();
      let paths: string[] = [];
      let activePath: string | null = null;
      if (session) {
        paths = session.tabs.map((tab) => tab.path);
        session.tabs.forEach((tab) => cursorByPath.set(tab.path, tab.cursorLine));
        activePath = session.tabs[session.activeIndex]?.path ?? paths[0] ?? null;
      } else {
        const lastFile = getLastFile();
        if (lastFile) {
          paths = [lastFile];
          activePath = lastFile;
        }
      }
      if (cliFile) {
        if (!paths.includes(cliFile)) paths.push(cliFile);
        activePath = cliFile;
      }
      if (paths.length === 0) {
        setBooting(false);
        return;
      }
      const loaded: TabState[] = [];
      let activeId: string | null = null;
      for (const path of paths) {
        try {
          const fileData = await invoke<FileData>("read_file", { path });
          const id = newTabId();
          loaded.push({
            id,
            filePath: fileData.path,
            fileName: fileData.name,
            content: fileData.content,
            originalContent: fileData.content,
            fileSize: fileData.size,
            knownMtime: fileData.modified ?? 0,
            cursorLine: cursorByPath.get(path),
          });
          if (path === activePath) activeId = id;
        } catch (error) {
          const message = errMessage(error);
          if (cliFile && path === cliFile) showToast(`Could not open file: ${message || path}`, "error");
          else if (/too large/i.test(message)) showToast(`Could not restore "${path}": ${message}`, "error");
        }
      }
      if (loaded.length === 0) {
        setSession(null);
        setLastFile(null);
        setBooting(false);
        return;
      }
      if (!activeId) activeId = loaded[0].id;
      const activeTab = loaded.find((tab) => tab.id === activeId)!;
      bumpDocSwap();
      commitTabs(loaded);
      setActiveTab(activeId);
      setFilePath(activeTab.filePath);
      setFileName(activeTab.fileName);
      setContent(activeTab.content);
      setOriginalContent(activeTab.content);
      setFileSize(activeTab.fileSize);
      knownMtimeRef.current = activeTab.knownMtime;
      addRecentFile(activeTab.filePath!, activeTab.fileName);
      setLastFile(activeTab.filePath);
      const line = activeTab.cursorLine ?? 1;
      if (line > 1) {
        window.setTimeout(
          () => window.dispatchEvent(new CustomEvent("paperling:goto-line", { detail: { line } })),
          150,
        );
      }
      if (getOpenInReader()) setMode("preview");
      setBooting(false);
    })();
    // Launch resolution deliberately runs once per webview load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleReorderTab = useCallback(
    (fromIndex: number, toIndex: number) => commitTabs(moveTab(tabsRef.current, fromIndex, toIndex)),
    [commitTabs],
  );

  const closeManyClean = useCallback(
    (ids: string[]) => {
      let keptDirty = 0;
      for (const id of ids) {
        const tab = tabsRef.current.find((entry) => entry.id === id);
        if (!tab) continue;
        const dirty =
          id === activeTabIdRef.current
            ? liveRef.current.content !== liveRef.current.originalContent
            : tab.content !== tab.originalContent;
        if (dirty) {
          keptDirty++;
          continue;
        }
        finalizeCloseTab(id);
      }
      if (keptDirty > 0) {
        showToast(`Kept ${keptDirty} unsaved tab${keptDirty > 1 ? "s" : ""} open`, "info");
      }
    },
    [finalizeCloseTab, showToast],
  );

  const handleTabMenuAction = useCallback(
    (action: "closeOthers" | "closeRight", id: string) => {
      const list = tabsRef.current;
      if (action === "closeOthers") closeManyClean(list.filter((tab) => tab.id !== id).map((tab) => tab.id));
      else {
        const index = list.findIndex((tab) => tab.id === id);
        if (index >= 0) closeManyClean(list.slice(index + 1).map((tab) => tab.id));
      }
      if (tabsRef.current.some((tab) => tab.id === id) && id !== activeTabIdRef.current) activateTab(id);
    },
    [activateTab, closeManyClean],
  );

  return {
    filePath,
    fileName,
    content,
    setContent,
    originalContent,
    fileSize,
    tabs,
    activeTabId,
    docSwapId,
    booting,
    isLoading,
    isDirty,
    hasFile,
    closeTabPrompt,
    cancelCloseTab,
    collectDirtyTabs,
    activateTab,
    cycleTab,
    loadFile,
    reopenClosedTab,
    gotoTabByIndex,
    closeTab,
    handleSaveCloseTab,
    handleDiscardCloseTab,
    handleNewFile,
    openTutorial,
    handleOpenFile,
    handleSaveAs,
    handleSaveFile,
    handleReorderTab,
    handleTabMenuAction,
  };
}
