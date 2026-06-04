import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { attachFocusTrap } from "../utils/focusTrap";
import mascotCarry from "../assets/mascot/mascot-carry.png";
import mascotShrug from "../assets/mascot/mascot-shrug.png";

interface FileEntry {
    name: string;
    path: string;
}

interface FileExplorerProps {
    isOpen: boolean;
    currentFilePath: string | null;
    onFileSelect: (path: string) => void;
    onClose: () => void;
}

export function FileExplorer({
    isOpen,
    currentFilePath,
    onFileSelect,
    onClose,
}: FileExplorerProps) {
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const panelRef = useRef<HTMLElement>(null);

    // Get directory from current file path
    const getDirectory = (filePath: string | null): string | null => {
        if (!filePath) return null;
        const normalized = filePath.replace(/\\/g, "/");
        const lastSlash = normalized.lastIndexOf("/");
        return lastSlash > 0 ? filePath.substring(0, lastSlash) : null;
    };

    useEffect(() => {
        if (isOpen && currentFilePath) {
            const directory = getDirectory(currentFilePath);
            if (directory) {
                loadFiles(directory);
            }
        }
    }, [isOpen, currentFilePath]);

    // Escape key to close and focus management + focus trap
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        panelRef.current?.focus();
        const detachTrap = attachFocusTrap(panelRef.current);

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
            detachTrap();
        };
    }, [isOpen, onClose]);

    const loadFiles = async (directory: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const entries = await invoke<FileEntry[]>("list_directory_files", {
                directory,
            });
            setFiles(entries);
        } catch (err) {
            console.error("Failed to load directory:", err);
            setError("Failed to load files");
        } finally {
            setIsLoading(false);
        }
    };

    const handleFileClick = (path: string) => {
        onFileSelect(path);
        onClose();
    };

    const directory = getDirectory(currentFilePath);
    const directoryName = directory
        ? directory.replace(/\\/g, "/").split("/").pop()
        : "Files";

    return (
        <aside
            ref={panelRef}
            role="navigation"
            aria-label="File explorer"
            tabIndex={-1}
            className={`fixed left-0 top-12 bottom-7 w-72 bg-[var(--bg-secondary)] border-r border-[var(--border)] z-50 shadow-2xl flex flex-col overflow-hidden transition-transform duration-200 ease-out ${isOpen ? "translate-x-0" : "-translate-x-full"
                }`}
        >
            {/* Header */}
            <div className="h-10 shrink-0 px-4 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-titlebar)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] no-select">
                    <span className="material-symbols-outlined text-[18px]">
                        folder_open
                    </span>
                    <span className="truncate max-w-[180px]">{directoryName}</span>
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close file explorer"
                    className="btn-press flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">
                        close
                    </span>
                </button>
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 overflow-y-auto">
                {isLoading ? (
                    <div className="flex items-center justify-center h-32 text-[var(--text-secondary)] text-sm">
                        Loading...
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm" role="alert">
                        <img src={mascotShrug} alt="" aria-hidden="true" draggable={false} className="w-20 h-20 object-contain select-none opacity-90" />
                        <span className="text-[var(--danger)]">{error}</span>
                    </div>
                ) : files.length === 0 ? (
                    <div className="flex flex-col items-center justify-center gap-3 py-10 text-sm text-[var(--text-secondary)]">
                        <img src={mascotCarry} alt="" aria-hidden="true" draggable={false} className="w-20 h-20 object-contain select-none opacity-90" />
                        <span>No markdown files here</span>
                    </div>
                ) : (
                    <ul className="py-2" role="listbox" aria-label="Markdown files">
                        {files.map((file, index) => {
                            const isActive = file.path === currentFilePath;
                            return (
                                <li key={file.path} className="stagger-item" style={{ animationDelay: `${index * 0.03}s` }}>
                                    <button
                                        onClick={() => handleFileClick(file.path)}
                                        role="option"
                                        aria-selected={isActive}
                                        className={`btn-press w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors ${isActive
                                            ? "bg-[var(--accent)] text-[var(--accent-text)]"
                                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                            }`}
                                    >
                                        <span className="material-symbols-outlined text-[16px]">
                                            description
                                        </span>
                                        <span className="truncate">{file.name}</span>
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </aside>
    );
}
