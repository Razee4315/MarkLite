import { useRef } from "react";
import { Modal } from "./Modal";
import mascotSad from "../assets/mascot/mascot-sad.png";

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
    const saveButtonRef = useRef<HTMLButtonElement>(null);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            role="alertdialog"
            labelledBy="unsaved-dialog-title"
            initialFocusRef={saveButtonRef}
            panelClassName="w-[380px]"
        >
            {/* Header */}
            <div className="px-5 pt-5 pb-3">
                <div className="flex items-center gap-3">
                    <img
                        src={mascotSad}
                        alt=""
                        aria-hidden="true"
                        draggable={false}
                        className="w-12 h-12 object-contain select-none shrink-0"
                    />
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
        </Modal>
    );
}
