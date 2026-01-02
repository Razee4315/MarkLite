import { Window } from "@tauri-apps/api/window";
import { message } from "@tauri-apps/plugin-dialog";
import { SettingsMenu } from "./SettingsMenu";

interface TitleBarProps {
    fileName?: string;
    isDirty?: boolean;
    filePath?: string;
    onOpenFile?: () => void;
    onSaveFile?: () => Promise<void>;
}

export function TitleBar({ fileName, isDirty, filePath, onOpenFile, onSaveFile }: TitleBarProps) {
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

    const handleClose = async () => {
        try {
            const appWindow = Window.getCurrent();
            
            // If there are unsaved changes, ask the user what to do
            if (isDirty) {
                const result = await message(
                    "Do you want to save changes before closing?",
                    {
                        title: "Unsaved Changes",
                        kind: "warning",
                        buttons: {
                            yes: "Save",
                            no: "Don't Save",
                            cancel: "Cancel"
                        }
                    }
                );
                
                if (result === "Save") {
                    // Save the file first, then close only if save succeeds
                    if (onSaveFile) {
                        try {
                            await onSaveFile();
                            await appWindow.close();
                        } catch (saveError) {
                            console.error("Save failed:", saveError);
                            // Don't close if save failed
                        }
                    } else {
                        await appWindow.close();
                    }
                } else if (result === "Don't Save") {
                    // Close without saving
                    await appWindow.close();
                }
                // If Cancel, do nothing (don't close)
            } else {
                await appWindow.close();
            }
        } catch (e) {
            console.error("Close failed:", e);
        }
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
        <header className="h-12 shrink-0 flex items-center justify-between px-4 bg-[var(--bg-titlebar)] border-b border-[var(--border)] no-select drag-region transition-colors">
            {/* Left: Icon & Title */}
            <div className="flex items-center gap-3 no-drag">
                <div className="flex items-center justify-center w-5 h-5">
                    <img src="/icon.svg" alt="MarkLite" className="w-full h-full" />
                </div>
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    {parentFolder && (
                        <>
                            <span className="opacity-60">{parentFolder} /</span>
                        </>
                    )}
                    <span className="text-[var(--text-primary)] font-semibold tracking-tight">
                        {fileName || "MarkLite"}
                    </span>
                    {isDirty && (
                        <span className="text-[var(--status-unsaved)] ml-1 italic text-xs">— Edited</span>
                    )}
                </div>

                {/* Open File Button - shown when a file is already open */}
                {hasFile && onOpenFile && (
                    <>
                        <div className="w-[1px] h-4 bg-[var(--border)] ml-2"></div>
                        <button
                            onClick={onOpenFile}
                            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs"
                            title="Open File (Ctrl+O)"
                        >
                            <span className="material-symbols-outlined text-[16px]">folder_open</span>
                            <span>Open</span>
                        </button>
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
                    onClick={handleClose}
                    aria-label="Close"
                    className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--danger)] text-[var(--text-secondary)] hover:text-[var(--accent-text)] transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
        </header>
    );
}
