import { memo } from "react";

export interface TabBarItem {
    id: string;
    name: string;
    dirty: boolean;
}

interface TabBarProps {
    tabs: TabBarItem[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNewTab: () => void;
}

function TabBarImpl({ tabs, activeId, onSelect, onClose, onNewTab }: TabBarProps) {
    return (
        <div
            role="tablist"
            aria-label="Open files"
            className="h-9 shrink-0 flex items-stretch overflow-x-auto bg-[var(--bg-titlebar)] border-b border-[var(--border)] no-select"
        >
            {tabs.map((tab) => {
                const isActive = tab.id === activeId;
                return (
                    <div
                        key={tab.id}
                        role="tab"
                        aria-selected={isActive}
                        title={tab.name}
                        onMouseDown={(e) => {
                            // Middle-click closes, like a browser.
                            if (e.button === 1) { e.preventDefault(); onClose(tab.id); }
                            else if (e.button === 0) onSelect(tab.id);
                        }}
                        className={`group/tab relative flex items-center gap-2 pl-3 pr-2 max-w-[200px] cursor-pointer border-r border-[var(--border)] transition-colors ${
                            isActive
                                ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        }`}
                    >
                        {/* Active-tab top accent */}
                        {isActive && <span className="absolute left-0 top-0 h-[2px] w-full bg-[var(--accent)]" aria-hidden="true" />}
                        <span className="material-symbols-outlined text-[14px] shrink-0 opacity-70">description</span>
                        <span className="truncate text-xs">{tab.name}</span>
                        {/* Dirty dot doubles as the close target on hover. */}
                        <button
                            onMouseDown={(e) => { e.stopPropagation(); }}
                            onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                            aria-label={`Close ${tab.name}`}
                            title="Close"
                            className="shrink-0 w-4 h-4 flex items-center justify-center rounded hover:bg-[var(--bg-hover)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                        >
                            {tab.dirty ? (
                                <>
                                    <span className="material-symbols-outlined text-[14px] group-hover/tab:hidden" aria-hidden="true">circle</span>
                                    <span className="material-symbols-outlined text-[14px] hidden group-hover/tab:inline" aria-hidden="true">close</span>
                                </>
                            ) : (
                                <span className="material-symbols-outlined text-[14px] opacity-0 group-hover/tab:opacity-100" aria-hidden="true">close</span>
                            )}
                        </button>
                    </div>
                );
            })}
            {/* New-tab button — always visible so it's clear more files can be
                opened in tabs. */}
            <button
                onClick={onNewTab}
                aria-label="New tab"
                title="New tab (Ctrl+N)"
                className="shrink-0 flex items-center justify-center w-9 text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
                <span className="material-symbols-outlined text-[18px]">add</span>
            </button>
        </div>
    );
}

export const TabBar = memo(TabBarImpl);
