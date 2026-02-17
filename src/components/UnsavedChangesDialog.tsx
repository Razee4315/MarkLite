import { useEffect, useRef } from "react";

interface UnsavedChangesDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onDiscard: () => void;
    onSave: () => void;
}

export function UnsavedChangesDialog({
    isOpen,
    onClose,
    onDiscard,
    onSave,
}: UnsavedChangesDialogProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const saveButtonRef = useRef<HTMLButtonElement>(null);

    // Focus trap and keyboard handling
    useEffect(() => {
        if (!isOpen) return;

        // Auto-focus the save button when dialog opens
        saveButtonRef.current?.focus();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
                return;
            }

            // Focus trap: keep Tab within dialog
            if (e.key === "Tab" && dialogRef.current) {
                const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
                    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
                );
                const first = focusable[0];
                const last = focusable[focusable.length - 1];

                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last?.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first?.focus();
                }
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden="true"
            />

            {/* Dialog */}
            <div
                ref={dialogRef}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="unsaved-dialog-title"
                aria-describedby="unsaved-dialog-desc"
                className="relative z-10 w-[380px] bg-[var(--bg-primary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden animate-fade-in"
            >
                {/* Header */}
                <div className="px-5 pt-5 pb-3">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[var(--status-unsaved)]/20 flex items-center justify-center">
                            <span className="material-symbols-outlined text-[var(--status-unsaved)] text-xl">
                                warning
                            </span>
                        </div>
                        <div>
                            <h2 id="unsaved-dialog-title" className="text-base font-semibold text-[var(--text-primary)]">
                                Unsaved Changes
                            </h2>
                            <p className="text-sm text-[var(--text-secondary)]">
                                Your changes will be lost
                            </p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="px-5 pb-4">
                    <p id="unsaved-dialog-desc" className="text-sm text-[var(--text-secondary)] leading-relaxed">
                        You have unsaved changes. Do you want to save them before closing?
                    </p>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-end gap-2 px-5 py-4 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onDiscard}
                        className="px-4 py-2 text-sm font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-lg transition-colors"
                    >
                        Don't Save
                    </button>
                    <button
                        ref={saveButtonRef}
                        onClick={onSave}
                        className="px-4 py-2 text-sm font-medium text-[var(--accent-text)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
}
