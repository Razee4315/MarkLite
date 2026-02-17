import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { listen, TauriEvent } from "@tauri-apps/api/event";

import { ThemeProvider } from "./context/ThemeContext";
import { TitleBar } from "./components/TitleBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { CodeEditor } from "./components/CodeEditor";
import { StatusBar } from "./components/StatusBar";
import { ModeToggle } from "./components/ModeToggle";
import { FileExplorer } from "./components/FileExplorer";
import { TableOfContents } from "./components/TableOfContents";
import { Toast } from "./components/Toast";

interface FileData {
  path: string;
  name: string;
  content: string;
  size: number;
  line_count: number;
}

type ViewMode = "preview" | "code";

// Utility function to count words in text
const getWordCount = (text: string): number => {
  if (!text || !text.trim()) return 0;
  return text.trim().split(/\s+/).length;
};

function AppContent() {
  // File state
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [originalContent, setOriginalContent] = useState<string>("");
  const [fileSize, setFileSize] = useState<number>(0);

  // UI state
  const [mode, setMode] = useState<ViewMode>("preview");
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });

  // Sidebar panel state
  const [showFileExplorer, setShowFileExplorer] = useState(false);
  const [showTOC, setShowTOC] = useState(false);

  // Preview scroll position
  const [previewLine, setPreviewLine] = useState(1);

  // Toast notification state
  const [toast, setToast] = useState({ message: '', isVisible: false });

  // Export HTML content ref - captures from visible preview
  const previewRef = useRef<HTMLDivElement>(null);

  // Derived state
  const isDirty = content !== originalContent;
  const lineCount = useMemo(() => content.split("\n").length, [content]);
  const hasFile = filePath !== null;
  const wordCount = useMemo(() => getWordCount(content), [content]);

  // Load file from path
  const loadFile = useCallback(async (path: string) => {
    try {
      const fileData = await invoke<FileData>("read_file", { path });
      setFilePath(fileData.path);
      setFileName(fileData.name);
      setContent(fileData.content);
      setOriginalContent(fileData.content);
      setFileSize(fileData.size);
      setMode("preview");
    } catch (err) {
      console.error("Failed to load file:", err);
    }
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

  // Save file
  const handleSaveFile = useCallback(async () => {
    if (!filePath) {
      // Save as new file
      const selected = await save({
        filters: [
          {
            name: "Markdown",
            extensions: ["md"],
          },
        ],
      });

      if (selected) {
        try {
          await invoke("save_file", { path: selected, content });
          setFilePath(selected);
          setOriginalContent(content);
        } catch (err) {
          console.error("Failed to save file:", err);
        }
      }
    } else {
      // Save to existing path
      try {
        await invoke("save_file", { path: filePath, content });
        setOriginalContent(content);
      } catch (err) {
        console.error("Failed to save file:", err);
      }
    }
  }, [filePath, content]);

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

  // Toggle mode
  const handleToggleMode = useCallback(() => {
    setMode((prev) => (prev === "preview" ? "code" : "preview"));
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

  // Handle image paste success
  const handleImagePaste = useCallback(() => {
    setToast({ message: 'Image pasted successfully!', isVisible: true });
  }, []);

  // Hide toast
  const hideToast = useCallback(() => {
    setToast(prev => ({ ...prev, isVisible: false }));
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+O - Open file
      if (e.ctrlKey && e.key === "o") {
        e.preventDefault();
        handleOpenFile();
      }
      // Ctrl+S - Save file
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        if (hasFile || content) {
          handleSaveFile();
        }
      }
      // Ctrl+E - Toggle mode
      if (e.ctrlKey && e.key === "e") {
        e.preventDefault();
        if (hasFile) {
          handleToggleMode();
        }
      }
      // Ctrl+Shift+E - Toggle file explorer
      if (e.ctrlKey && e.shiftKey && e.key === "E") {
        e.preventDefault();
        if (hasFile) {
          handleToggleFileExplorer();
        }
      }
      // Ctrl+Shift+O - Toggle TOC
      if (e.ctrlKey && e.shiftKey && e.key === "O") {
        e.preventDefault();
        if (hasFile) {
          handleToggleTOC();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenFile, handleSaveFile, handleToggleMode, handleToggleFileExplorer, handleToggleTOC, hasFile, content]);

  // Get export HTML from the visible preview on demand (avoids duplicate rendering)
  const getExportHtml = useCallback((): string => {
    if (previewRef.current) {
      return previewRef.current.innerHTML;
    }
    return "";
  }, []);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] overflow-hidden transition-colors">
      <TitleBar
        fileName={fileName ?? undefined}
        isDirty={isDirty}
        filePath={filePath ?? undefined}
        onOpenFile={handleOpenFile}
        onSaveFile={handleSaveFile}
        getExportHtml={getExportHtml}
      />

      {!hasFile ? (
        <WelcomeScreen onOpenFile={handleOpenFile} onFileDrop={handleFileDrop} />
      ) : (
        <>
          {mode === "preview" ? (
<div key="preview" className="flex-1 animate-fade-in overflow-hidden flex flex-col">
              <MarkdownPreview
                content={content}
                fileName={fileName || ""}
                lineCount={lineCount}
                fileSize={fileSize}
                onEditClick={handleToggleMode}
                onLineChange={(line) => setPreviewLine(line)}
                filePath={filePath}
                markdownBodyRef={previewRef}
              />
            </div>
          ) : (
<div key="code" className="flex-1 animate-fade-in overflow-hidden flex flex-col">
              <CodeEditor
                content={content}
                onChange={handleContentChange}
                onCursorChange={(line, col) => setCursorPosition({ line, col })}
                onImagePaste={handleImagePaste}
                filePath={filePath}
              />
            </div>
          )}

          <ModeToggle mode={mode} onToggle={handleToggleMode} />

          {/* Sidebar Panels */}
          <FileExplorer
            isOpen={showFileExplorer}
            currentFilePath={filePath}
            onFileSelect={loadFile}
            onClose={closeAllPanels}
          />
          <TableOfContents
            isOpen={showTOC}
            content={content}
            onClose={closeAllPanels}
          />

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
          />
        </>
      )}

      {/* Toast notifications */}
      <Toast 
        message={toast.message} 
        isVisible={toast.isVisible} 
        onHide={hideToast} 
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
