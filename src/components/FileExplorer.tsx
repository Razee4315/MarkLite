import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

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
        <>

            <aside
                className={`fixed left-0 top-12 bottom-7 w-72 bg-[var(--bg-secondary)] border-r border-[var(--border)] z-50 shadow-2xl transition-transform duration-200 ease-out ${isOpen ? "translate-x-0" : "-translate-x-full"
                    }`}
            >
                {/* Header */}
                <div className="h-10 px-4 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-titlebar)]">
                    <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] no-select">
                        <span className="material-symbols-outlined text-[18px]">
                            folder_open
                        </span>
                        <span className="truncate max-w-[180px]">{directoryName}</span>
                    </div>
                    <button
                        onClick={onClose}
                        className="btn-press flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">
                            close
                        </span>
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto h-[calc(100%-2.5rem)]">
                    {isLoading ? (
                        <div className="flex items-center justify-center h-32 text-[var(--text-secondary)] text-sm">
                            Loading...
                        </div>
                    ) : error ? (
                        <div className="flex items-center justify-center h-32 text-[var(--danger)] text-sm">
                            {error}
                        </div>
                    ) : files.length === 0 ? (
                        <div className="flex items-center justify-center h-32 text-[var(--text-secondary)] text-sm">
                            No markdown files
                        </div>
                    ) : (
                        <ul className="py-2">
                            {files.map((file, index) => {
                                const isActive = file.path === currentFilePath;
                                return (
                                    <li key={file.path} className="stagger-item" style={{ animationDelay: `${index * 0.03}s` }}>
                                        <button
                                            onClick={() => handleFileClick(file.path)}
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
        </>
    );
}
