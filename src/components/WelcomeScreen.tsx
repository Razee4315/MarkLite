interface WelcomeScreenProps {
    onOpenFile: () => void;
    onFileDrop: (path: string) => void;
}

export function WelcomeScreen({ onOpenFile, onFileDrop }: WelcomeScreenProps) {
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            const file = files[0];
            // @ts-expect-error - Tauri adds path to File objects
            const path = file.path || file.name;
            if (path.endsWith('.md') || path.endsWith('.markdown')) {
                onFileDrop(path);
            }
        }
    };

    return (
        <main
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className="flex-1 flex flex-col items-center justify-center p-6 no-select"
        >
            <div className="flex flex-col items-center gap-8 max-w-sm text-center animate-fade-in-up">
                {/* Logo */}
                <div className="flex items-center justify-center w-20 h-20">
                    <img src="/icon.svg" alt="MarkLite" className="w-full h-full" />
                </div>

                {/* App Name */}
                <div className="flex flex-col gap-2">
                    <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
                        MarkLite
                    </h1>
                    <p className="text-sm text-[var(--text-secondary)]">
                        A minimal markdown editor
                    </p>
                </div>

                {/* Action */}
                <button
                    onClick={onOpenFile}
                    className="btn-press flex items-center gap-2 bg-[var(--accent)] hover:opacity-90 text-[var(--accent-text)] font-medium text-sm px-6 py-2.5 rounded-lg transition-all duration-200"
                >
                    <span className="material-symbols-outlined text-[20px]">folder_open</span>
                    <span>Open File</span>
                </button>

                {/* Hint */}
                <p className="text-xs text-[var(--text-muted)]">
                    or drag and drop a <code className="bg-[var(--bg-secondary)] px-1.5 py-0.5 rounded text-[var(--text-secondary)] border border-[var(--border)]">.md</code> file
                </p>
            </div>

        </main>
    );
}
