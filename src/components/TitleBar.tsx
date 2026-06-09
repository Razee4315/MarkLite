import { useState, lazy, Suspense, memo } from "react";
import type { MouseEvent } from "react";
import { Window } from "@tauri-apps/api/window";
import { SettingsMenu } from "./SettingsMenu";
import { ExportMenu } from "./ExportMenu";

// Loaded only when the user actually tries to close a dirty buffer.
// Eager-importing this kept its module (and its chained imports) in the
// main bundle even though most sessions never trigger the dialog.
const UnsavedChangesDialog = lazy(() =>
    import("./UnsavedChangesDialog").then((m) => ({ default: m.UnsavedChangesDialog }))
);

interface TitleBarProps {
    fileName?: string;
    isDirty?: boolean;
    filePath?: string;
    onOpenFile?: () => void;
    onNewFile?: () => void;
    onSaveFile?: () => Promise<void>;
    getExportHtml?: () => string;
    onExportSuccess?: (format: string) => void;
    onExportError?: (format: string) => void;
    onToggleAI?: () => void;
    aiActive?: boolean;
}

function TitleBarImpl({ fileName, isDirty, filePath, onOpenFile, onNewFile, onSaveFile, getExportHtml, onExportSuccess, onExportError, onToggleAI, aiActive }: TitleBarProps) {
    const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);

    const handleMinimize = async () => {
        try {
            const appWindow = Window.getCurrent();
            await appWindow.minimize();
        } catch (e) {
            console.error("Minimize failed:", e);
        }
    };

    const handleMaximize = async () => {
        try {
            const appWindow = Window.getCurrent();
            await appWindow.toggleMaximize();
        } catch (e) {
            console.error("Maximize failed:", e);
        }
    };

    const handleTitleBarMouseDown = async (event: MouseEvent<HTMLElement>) => {
        const target = event.target;

        if (
            event.button !== 0 ||
            (target instanceof Element &&
                target.closest("button, a, input, textarea, select, [role='button'], [role='menu'], [role='menuitem']"))
        ) {
            return;
        }

        try {
            const appWindow = Window.getCurrent();
            // Native title bars maximize on double-click; event.detail
            // counts clicks within the double-click interval.
            if (event.detail === 2) {
                await appWindow.toggleMaximize();
            } else {
                await appWindow.startDragging();
            }
        } catch (e) {
            console.error("Window drag failed:", e);
        }
    };

    const handleCloseClick = () => {
        if (isDirty) {
            setShowUnsavedDialog(true);
        } else {
            forceClose();
        }
    };

    const forceClose = async () => {
        try {
            const appWindow = Window.getCurrent();
            await appWindow.close();
        } catch (e) {
            console.error("Close failed:", e);
        }
    };

    const handleSaveAndClose = async () => {
        if (onSaveFile) {
            await onSaveFile();
        }
        forceClose();
    };

    const handleDiscardAndClose = () => {
        setShowUnsavedDialog(false);
        forceClose();
    };

    // Extract parent folder from path for breadcrumb
    const getPathBreadcrumb = () => {
        if (!filePath) return null;
        const parts = filePath.replace(/\\/g, "/").split("/");
        if (parts.length >= 2) {
            return parts.slice(-2, -1)[0];
        }
        return null;
    };

    const parentFolder = getPathBreadcrumb();
    const hasFile = !!fileName;

    return (
        <>
            {showUnsavedDialog && (
                <Suspense fallback={null}>
                    <UnsavedChangesDialog
                        isOpen={showUnsavedDialog}
                        onClose={() => setShowUnsavedDialog(false)}
                        onDiscard={handleDiscardAndClose}
                        onSave={handleSaveAndClose}
                    />
                </Suspense>
            )}
            <header
                onMouseDown={handleTitleBarMouseDown}
                className="h-12 shrink-0 flex items-center justify-between px-4 bg-[var(--bg-titlebar)] border-b border-[var(--border)] no-select drag-region transition-colors"
            >
                {/* Left: Icon & Title */}
                <div className="flex items-center gap-3 no-drag">
                    <div className="flex items-center justify-center w-5 h-5">
                        <img src="/icon.svg" alt="Paperling" className="w-full h-full" />
                    </div>
                    <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                        {parentFolder && (
                            <>
                                <span className="opacity-60">{parentFolder} /</span>
                            </>
                        )}
                        <span className="text-[var(--text-primary)] font-semibold tracking-tight">
                            {fileName || "Paperling"}
                        </span>
                        {!fileName && (
                            <span className="text-[var(--text-muted)] text-xs ml-1 hidden sm:inline">— drop a .md file or Ctrl+O</span>
                        )}
                        {isDirty && (
                            <span className="text-[var(--status-unsaved)] ml-1 italic text-xs">— Edited</span>
                        )}
                    </div>

                    {/* Open File / New Button - shown when a file is already open */}
                    {hasFile && onOpenFile && (
                        <>
                            <div className="w-[1px] h-4 bg-[var(--border)] ml-2"></div>
                            {onNewFile && (
                                <button
                                    onClick={onNewFile}
                                    aria-label="New file"
                                    className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs"
                                    title="New File (Ctrl+N)"
                                >
                                    <span className="material-symbols-outlined text-[16px]">edit_note</span>
                                    <span>New</span>
                                </button>
                            )}
                            <button
                                onClick={onOpenFile}
                                aria-label="Open file"
                                className="flex items-center gap-1 px-2 py-1 rounded-[var(--radius-md)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs"
                                title="Open File (Ctrl+O)"
                            >
                                <span className="material-symbols-outlined text-[16px]">folder_open</span>
                                <span>Open</span>
                            </button>
                            <ExportMenu
                                fileName={fileName || 'document.md'}
                                getExportHtml={getExportHtml}
                                onSuccess={onExportSuccess}
                                onError={onExportError}
                            />
                            {onToggleAI && (
                                <button
                                    onClick={onToggleAI}
                                    aria-label="AI assistant"
                                    aria-pressed={aiActive}
                                    title="AI assistant"
                                    className={`flex items-center px-2.5 py-1 rounded-[var(--radius-md)] transition-colors text-xs font-semibold tracking-wide ${aiActive
                                        ? "bg-[var(--bg-hover)] text-[var(--accent)]"
                                        : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                                        }`}
                                >
                                    <span>AI</span>
                                </button>
                            )}
                        </>
                    )}
                </div>

                {/* Right: Settings & Window Controls */}
                <div className="flex items-center gap-1 no-drag">
                    <SettingsMenu />
                    <div className="w-[1px] h-4 bg-[var(--border)] mx-1"></div>
                    <button
                        onClick={handleMinimize}
                        aria-label="Minimize"
                        className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">remove</span>
                    </button>
                    <button
                        onClick={handleMaximize}
                        aria-label="Maximize"
                        className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[16px]">crop_square</span>
                    </button>
                    <button
                        onClick={handleCloseClick}
                        aria-label="Close"
                        className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--danger)] text-[var(--text-secondary)] hover:text-[var(--accent-text)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </header>
        </>
    );
}

// React.memo + useCallback'd parent props means the TitleBar skips re-render
// while the user is typing. Without this every keystroke reconciled the
// header — cheap individually, but it adds up on hot paths. The default
// shallow prop comparison is enough; all props are primitives or stable
// callbacks from App.
export const TitleBar = memo(TitleBarImpl);
