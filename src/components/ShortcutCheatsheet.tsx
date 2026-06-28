import { useEffect, useRef, useState } from "react";
import { attachFocusTrap } from "../utils/focusTrap";
import iconKeyboard from "../assets/mascot/icon-keyboard.png";

interface ShortcutCheatsheetProps {
    isOpen: boolean;
    onClose: () => void;
}

interface Shortcut {
    keys: string;
    description: string;
}

interface ShortcutGroup {
    title: string;
    items: Shortcut[];
}

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const isWindows = typeof navigator !== "undefined" && /Win/.test(navigator.platform);
const cmd = isMac ? "⌘" : "Ctrl";
// On Windows, WebView2 grabs Ctrl+J for the built-in Downloads UI before
// the page can preventDefault, so we surface Alt+J as the primary AI
// shortcut there. macOS / Linux see Ctrl+J fine.
const aiShortcut = isWindows ? "Alt+J" : `${cmd}+J`;

const groups: ShortcutGroup[] = [
    {
        title: "File",
        items: [
            { keys: `${cmd}+O`, description: "Open file" },
            { keys: `${cmd}+N`, description: "New file" },
            { keys: `${cmd}+S`, description: "Save" },
            { keys: `${cmd}+Shift+S`, description: "Save As…" },
        ],
    },
    {
        title: "View",
        items: [
            { keys: `${cmd}+E`, description: "Toggle Reader / Code" },
            { keys: `${cmd}+\\`, description: "Toggle split view" },
            { keys: "Alt+←", description: "Back (previous file)" },
            { keys: "Alt+→", description: "Forward" },
            { keys: "F11", description: "Toggle fullscreen" },
            { keys: `${cmd}+Shift+E`, description: "Toggle file explorer" },
            { keys: `${cmd}+Shift+O`, description: "Toggle outline" },
            { keys: `${cmd}+P`, description: "Command palette" },
            { keys: `${cmd}+,`, description: "Open settings" },
            { keys: "?", description: "Show this cheatsheet" },
        ],
    },
    {
        title: "AI",
        items: [
            { keys: aiShortcut, description: "AI assist on selection (also: ✨ toolbar button, command palette)" },
        ],
    },
    {
        title: "Editor — Formatting",
        items: [
            { keys: `${cmd}+B`, description: "Bold (toggle)" },
            { keys: `${cmd}+I`, description: "Italic (toggle)" },
            { keys: `${cmd}+K`, description: "Insert link" },
            { keys: `${cmd}+/`, description: "Toggle blockquote on line" },
        ],
    },
    {
        title: "Editor — Navigation",
        items: [
            { keys: "Tab", description: "Indent line / selection" },
            { keys: "Shift+Tab", description: "Outdent line / selection" },
            { keys: "Enter", description: "Continue list, blockquote, or task item" },
            { keys: `${cmd}+F`, description: "Find" },
            { keys: `${cmd}+H`, description: "Find and replace" },
        ],
    },
    {
        title: "Editor — Auto-pair",
        items: [
            { keys: "( [ { ` \" '", description: "Wrap selection or insert pair" },
            { keys: ") ] } ` \" '", description: "Type past matching closer" },
            { keys: "Backspace", description: "Removes empty pair atomically" },
        ],
    },
    {
        title: "Slash & Smart Paste",
        items: [
            { keys: "/", description: "Slash menu (at line start)" },
            { keys: "Paste URL on selection", description: "Wraps selection as link" },
            { keys: "Paste rich HTML", description: "Converts to markdown" },
            { keys: "Paste tab-separated", description: "Converts to GFM table" },
        ],
    },
];

const renderKey = (k: string): React.ReactNode => {
    return k.split(/\s+/).map((part, i) => (
        <span key={i} className="inline-flex items-center">
            {i > 0 && <span className="mx-0.5 text-[var(--text-muted)]">+</span>}
            <kbd className="px-1.5 py-0.5 text-[11px] font-mono rounded border border-[var(--border)] bg-[var(--bg-input)] text-[var(--text-primary)] shadow-sm">
                {part}
            </kbd>
        </span>
    ));
};

export function ShortcutCheatsheet({ isOpen, onClose }: ShortcutCheatsheetProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const [filter, setFilter] = useState("");

    useEffect(() => {
        if (!isOpen) return;
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", handleKey);
        // Trap first (captures the trigger for focus-restore on close), then
        // move focus into the search input. UX-01.
        const detach = attachFocusTrap(dialogRef.current);
        const input = dialogRef.current?.querySelector<HTMLInputElement>("input");
        input?.focus();
        return () => {
            document.removeEventListener("keydown", handleKey);
            detach();
        };
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const q = filter.trim().toLowerCase();
    const filtered = q
        ? groups
            .map((g) => ({
                ...g,
                items: g.items.filter((it) => it.description.toLowerCase().includes(q) || it.keys.toLowerCase().includes(q)),
            }))
            .filter((g) => g.items.length > 0)
        : groups;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-labelledby="cheatsheet-title">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

            <div
                ref={dialogRef}
                className="relative z-10 w-[640px] max-h-[80vh] flex flex-col bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden animate-fade-in"
            >
                <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
                    <img src={iconKeyboard} alt="" aria-hidden="true" draggable={false} className="w-8 h-8 object-contain select-none" />
                    <h2 id="cheatsheet-title" className="text-base font-semibold text-[var(--text-primary)]">Keyboard Shortcuts</h2>
                    <input
                        type="text"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        placeholder="Filter shortcuts…"
                        aria-label="Filter shortcuts"
                        className="ml-auto px-2 py-1 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] w-48"
                    />
                    <button
                        onClick={onClose}
                        aria-label="Close cheatsheet"
                        className="w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4 grid grid-cols-2 gap-x-6 gap-y-5">
                    {filtered.length === 0 ? (
                        <div className="col-span-2 text-center text-[var(--text-secondary)] py-8 text-sm">
                            No shortcuts match "{filter}"
                        </div>
                    ) : filtered.map((g) => (
                        <section key={g.title}>
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)] mb-2">
                                {g.title}
                            </h3>
                            <ul className="space-y-1.5">
                                {g.items.map((it, i) => (
                                    <li key={i} className="flex items-center justify-between gap-3">
                                        <span className="text-sm text-[var(--text-primary)]">{it.description}</span>
                                        <span className="flex items-center gap-1 shrink-0">{renderKey(it.keys)}</span>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    ))}
                </div>

                <div className="px-5 py-2 text-[11px] text-[var(--text-muted)] border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]">
                    Press <kbd className="px-1 py-0.5 font-mono rounded border border-[var(--border)] bg-[var(--bg-input)]">Esc</kbd> to close
                </div>
            </div>
        </div>
    );
}
