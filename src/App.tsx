import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";

import { ThemeProvider } from "./context/ThemeContext";
import { TitleBar } from "./components/TitleBar";
import { WelcomeScreen } from "./components/WelcomeScreen";
import { MarkdownPreview } from "./components/MarkdownPreview";
import { CodeEditor } from "./components/CodeEditor";
import { StatusBar } from "./components/StatusBar";
import { ModeToggle } from "./components/ModeToggle";

interface FileData {
  path: string;
  name: string;
  content: string;
  size: number;
  line_count: number;
}

type ViewMode = "preview" | "code";

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

  // Derived state
  const isDirty = content !== originalContent;
  const lineCount = content.split("\n").length;
  const hasFile = filePath !== null;

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

  // Toggle mode
  const handleToggleMode = useCallback(() => {
    setMode((prev) => (prev === "preview" ? "code" : "preview"));
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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleOpenFile, handleSaveFile, handleToggleMode, hasFile, content]);

  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] overflow-hidden transition-colors">
      <TitleBar fileName={fileName ?? undefined} isDirty={isDirty} filePath={filePath ?? undefined} onOpenFile={handleOpenFile} />

      {!hasFile ? (
        <WelcomeScreen onOpenFile={handleOpenFile} onFileDrop={handleFileDrop} />
      ) : (
        <>
          {mode === "preview" ? (
            <MarkdownPreview
              content={content}
              fileName={fileName || ""}
              lineCount={lineCount}
              fileSize={fileSize}
              onEditClick={handleToggleMode}
            />
          ) : (
            <CodeEditor content={content} onChange={handleContentChange} />
          )}

          <ModeToggle mode={mode} onToggle={handleToggleMode} />
          <StatusBar
            isSaved={!isDirty}
            lineNumber={cursorPosition.line}
            columnNumber={cursorPosition.col}
          />
        </>
      )}
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
