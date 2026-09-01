import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { normalizeMarkdownFileName } from "../utils/mobileFiles";

interface SaveAsNameModalProps {
    isOpen: boolean;
    /** The buffer's current (untitled) name, used as the starting value. */
    defaultName?: string | null;
    /** Resolves with the chosen name (already normalized), or null on cancel. */
    onConfirm: (name: string | null) => void;
}

/**
 * Mobile Save As. The OS save panel is unusable on Android (it returns a SAF
 * URI the Rust file commands can't read), so saving an untitled buffer asks
 * for a NAME and writes into the app-private notes folder. The path is built
 * by the caller via joinNotesPath; this modal only owns the name.
 */
export function SaveAsNameModal({ isOpen, defaultName, onConfirm }: SaveAsNameModalProps) {
    const [value, setValue] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    // Re-seed each open so a second untitled buffer doesn't inherit the last name.
    useEffect(() => {
        if (isOpen) {
            setValue(defaultName ?? "");
            // Let the field mount before focusing; the keyboard should come up
            // right away — naming the note IS the task on this screen.
            window.setTimeout(() => {
                inputRef.current?.focus();
                inputRef.current?.select();
            }, 50);
        }
    }, [isOpen, defaultName]);

    const normalized = normalizeMarkdownFileName(value);
    const valid = value.trim().length > 0;

    return (
        <Modal
            isOpen={isOpen}
            onClose={() => onConfirm(null)}
            labelledBy="saveas-title"
            panelClassName="w-[min(420px,calc(100vw-1.5rem))]"
        >
            <div className="px-5 pt-5 pb-4">
                <h2 id="saveas-title" className="text-base font-semibold text-[var(--text-primary)]">
                    Save note
                </h2>
                <p className="text-sm text-[var(--text-secondary)] mt-1">
                    Saved to your notes folder on this device.
                </p>
                <input
                    ref={inputRef}
                    type="text"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && valid) onConfirm(normalized);
                        if (e.key === "Escape") onConfirm(null);
                    }}
                    placeholder="Note name"
                    aria-label="Note name"
                    enterKeyHint="done"
                    className="mt-3 w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                />
                {valid && normalized !== value && (
                    <p className="text-xs text-[var(--text-muted)] mt-1.5">Will save as “{normalized}”</p>
                )}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
                <button
                    onClick={() => onConfirm(null)}
                    className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded-lg transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={() => valid && onConfirm(normalized)}
                    disabled={!valid}
                    className="px-4 py-2 text-sm font-medium text-[var(--accent-text)] bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                    Save
                </button>
            </div>
        </Modal>
    );
}
