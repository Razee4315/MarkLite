interface StatusBarProps {
    isSaved: boolean;
    lineNumber: number;
    columnNumber: number;
    fileType?: string;
}

export function StatusBar({
    isSaved,
    lineNumber,
    columnNumber,
    fileType = "Markdown",
}: StatusBarProps) {
    return (
        <footer className="h-7 shrink-0 bg-[#15202b] border-t border-[#233648] px-4 flex items-center justify-between text-[11px] font-medium tracking-wide text-[#6272a4] no-select">
            <div className="flex items-center gap-4">
                <div className="hover:text-[#f8f8f2] cursor-default transition-colors">
                    {fileType}
                </div>
            </div>
            <div className="flex items-center gap-4">
                <div className="flex items-center gap-1.5">
                    <span
                        className={`w-2 h-2 rounded-full ${isSaved
                                ? "bg-[#50fa7b] shadow-[0_0_4px_rgba(80,250,123,0.4)]"
                                : "bg-[#ffb86c] shadow-[0_0_4px_rgba(255,184,108,0.4)]"
                            }`}
                    ></span>
                    <span>{isSaved ? "Saved" : "Unsaved"}</span>
                </div>
                <div className="hover:text-[#f8f8f2] cursor-default transition-colors">
                    Ln {lineNumber}, Col {columnNumber}
                </div>
                <div className="hover:text-[#f8f8f2] cursor-default transition-colors">
                    UTF-8
                </div>
            </div>
        </footer>
    );
}
