interface ModeToggleProps {
    mode: "preview" | "code";
    onToggle: () => void;
}

export function ModeToggle({ mode, onToggle }: ModeToggleProps) {
    return (
        <div className="fixed bottom-8 right-8 z-50">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-full p-1.5 flex items-center shadow-2xl backdrop-blur-sm transition-colors">
                {/* Preview/Reader Button */}
                <button
                    onClick={mode === "code" ? onToggle : undefined}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 ${mode === "preview"
                        ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-md"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                >
                    <span className="material-symbols-outlined text-[20px]">visibility</span>
                    {mode === "preview" && <span className="text-sm font-bold">Reader</span>}
                </button>

                {/* Code/Edit Button */}
                <button
                    onClick={mode === "preview" ? onToggle : undefined}
                    className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200 group ${mode === "code"
                        ? "bg-[var(--accent)] text-[var(--accent-text)] shadow-md"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                >
                    {mode === "code" && <span className="text-sm font-bold">Code</span>}
                    <span className="material-symbols-outlined text-[20px]">code</span>
                </button>
            </div>

            {/* Keyboard Shortcut Hint */}
            <div className="absolute -top-8 left-1/2 transform -translate-x-1/2 text-xs text-[var(--text-secondary)] opacity-0 hover:opacity-100 transition-opacity bg-[var(--bg-primary)]/90 px-2 py-1 rounded whitespace-nowrap pointer-events-none">
                Ctrl + E
            </div>
        </div>
    );
}
