import type { ViewMode } from "./ModeToggle";

interface MobileBottomNavProps {
    hasFile: boolean;
    mode: ViewMode;
    onSetMode: (mode: ViewMode) => void;
    onOpenFiles: () => void;
    onNewFile: () => void;
}

interface NavButton {
    id: string;
    icon: string;
    label: string;
    active?: boolean;
    onSelect: () => void;
}

/**
 * The phone's bottom navigation bar: Files (notes browser), New note, and the
 * Read/Edit toggle. Deliberately minimal (feedback round 1): the formatting
 * toolbar is always visible above the editor, and the AI assistant lives in
 * the ☰ menu, so neither needs a nav slot.
 *
 * ≥48dp targets, safe-area padded, in-flow at the bottom of the shell (like
 * the desktop StatusBar it replaces), and hidden while the on-screen keyboard
 * is open (html.kb-open) so it never sits behind the IME.
 */
export function MobileBottomNav({ hasFile, mode, onSetMode, onOpenFiles, onNewFile }: MobileBottomNavProps) {
    const buttons: NavButton[] = [
        { id: "files", icon: "folder_open", label: "Files", onSelect: onOpenFiles },
        { id: "new", icon: "note_add", label: "New", onSelect: onNewFile },
        ...(hasFile
            ? [
                  {
                      id: "mode",
                      icon: mode === "preview" ? "edit" : "visibility",
                      label: mode === "preview" ? "Edit" : "Read",
                      active: mode === "preview",
                      onSelect: () => onSetMode(mode === "preview" ? "code" : "preview"),
                  },
              ]
            : []),
    ];

    return (
        <nav
            aria-label="Main"
            // In-flow at the bottom of the flex-column shell (like the desktop
            // StatusBar it replaces) — content never hides behind it, and the
            // kb-open display:none simply reflows the editor taller.
            className="mobile-bottomnav shrink-0 flex bg-[var(--bg-titlebar)] border-t border-[var(--border)] no-select"
            style={{ paddingBottom: "max(env(safe-area-inset-bottom, 0px), 4px)" }}
        >
            {buttons.map((b) => (
                <button
                    key={b.id}
                    onClick={b.onSelect}
                    aria-label={b.label}
                    aria-pressed={b.active}
                    className={`flex-1 flex flex-col items-center justify-center gap-0.5 pt-2 pb-1 min-h-[56px] transition-colors ${
                        b.active
                            ? "text-[var(--accent)]"
                            : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] active:bg-[var(--bg-hover)]"
                    }`}
                >
                    <span className="material-symbols-outlined text-[22px]">{b.icon}</span>
                    <span className="text-[10px] leading-none">{b.label}</span>
                </button>
            ))}
        </nav>
    );
}
