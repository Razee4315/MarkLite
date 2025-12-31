import { Window } from "@tauri-apps/api/window";

interface TitleBarProps {
    fileName?: string;
    isDirty?: boolean;
    filePath?: string;
    onOpenFile?: () => void;
}

export function TitleBar({ fileName, isDirty, filePath, onOpenFile }: TitleBarProps) {
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
            await appWindow.close();
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
        <header className="h-12 shrink-0 flex items-center justify-between px-4 bg-[#191a21] border-b border-[#44475a] no-select drag-region">
            {/* Left: Icon & Title */}
            <div className="flex items-center gap-3 no-drag">
                <div className="text-[#bd93f9] flex items-center justify-center">
                    <span className="material-symbols-outlined text-xl">markdown</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-[#6272a4]">
                    {parentFolder && (
                        <>
                            <span className="opacity-60">{parentFolder} /</span>
                        </>
                    )}
                    <span className="text-[#f8f8f2] font-semibold tracking-tight">
                        {fileName || "MarkLite"}
                    </span>
                    {isDirty && (
                        <span className="text-[#ffb86c] ml-1 italic text-xs">— Edited</span>
                    )}
                </div>

                {/* Open File Button - shown when a file is already open */}
                {hasFile && onOpenFile && (
                    <>
                        <div className="w-[1px] h-4 bg-[#44475a] ml-2"></div>
                        <button
                            onClick={onOpenFile}
                            className="flex items-center gap-1 px-2 py-1 rounded hover:bg-[#44475a] text-[#6272a4] hover:text-[#f8f8f2] transition-colors text-xs"
                            title="Open File (Ctrl+O)"
                        >
                            <span className="material-symbols-outlined text-[16px]">folder_open</span>
                            <span>Open</span>
                        </button>
                    </>
                )}
            </div>

            {/* Right: Window Controls */}
            <div className="flex gap-1 no-drag">
                <button
                    onClick={handleMinimize}
                    aria-label="Minimize"
                    className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#44475a] text-[#6272a4] hover:text-[#f8f8f2] transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">remove</span>
                </button>
                <button
                    onClick={handleMaximize}
                    aria-label="Maximize"
                    className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#44475a] text-[#6272a4] hover:text-[#f8f8f2] transition-colors"
                >
                    <span className="material-symbols-outlined text-[16px]">crop_square</span>
                </button>
                <button
                    onClick={handleClose}
                    aria-label="Close"
                    className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[#ff5555] text-[#6272a4] hover:text-[#282a36] transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
            </div>
        </header>
    );
}
