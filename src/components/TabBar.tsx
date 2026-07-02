import { memo, useEffect, useRef, useState } from "react";

export interface TabBarItem {
    id: string;
    /** Bare file name — used for the tooltip and accessible name. */
    name: string;
    /** Display label; may be disambiguated with a folder suffix (TABS-09). */
    label: string;
    dirty: boolean;
}

interface TabBarProps {
    tabs: TabBarItem[];
    activeId: string | null;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onNewTab: () => void;
    /** Drag-reorder: move the tab at fromIndex to toIndex. TABS-10. */
    onReorder?: (fromIndex: number, toIndex: number) => void;
    /** Right-click context menu on a tab. TABS-12. */
    onContextMenu?: (id: string, x: number, y: number) => void;
}

function TabBarImpl({ tabs, activeId, onSelect, onClose, onNewTab, onReorder, onContextMenu }: TabBarProps) {
    const listRef = useRef<HTMLDivElement>(null);
    const tabRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [overIndex, setOverIndex] = useState<number | null>(null);

    // Keep the active tab scrolled into view when it changes (e.g. Ctrl+Tab to a
    // tab that's currently off-screen in an overflowing bar). TABS-13.
    useEffect(() => {
        if (!activeId) return;
        tabRefs.current.get(activeId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, [activeId, tabs.length]);

    // Vertical wheel scrolls the bar horizontally, like a browser tab strip.
    const onWheel = (e: React.WheelEvent) => {
        const el = listRef.current;
        if (!el || e.deltaY === 0) return;
        el.scrollLeft += e.deltaY;
    };

    // Roving-tabindex keyboard navigation across the tablist. TABS-14.
    const onKeyDown = (e: React.KeyboardEvent, index: number) => {
        const focusAndSelect = (i: number) => {
            const t = tabs[i];
            if (!t) return;
            onSelect(t.id);
            tabRefs.current.get(t.id)?.focus();
        };
        if (e.key === "ArrowRight") {
            e.preventDefault();
            focusAndSelect((index + 1) % tabs.length);
        } else if (e.key === "ArrowLeft") {
            e.preventDefault();
            focusAndSelect((index - 1 + tabs.length) % tabs.length);
        } else if (e.key === "Home") {
            e.preventDefault();
            focusAndSelect(0);
        } else if (e.key === "End") {
            e.preventDefault();
            focusAndSelect(tabs.length - 1);
        } else if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(tabs[index].id);
        } else if (e.key === "Delete" || e.key === "Backspace") {
            e.preventDefault();
            onClose(tabs[index].id);
        }
    };

    return (
        <div
            ref={listRef}
            role="tablist"
            aria-label="Open files"
            onWheel={onWheel}
            className="h-9 shrink-0 flex items-stretch overflow-x-auto bg-[var(--bg-titlebar)] border-b border-[var(--border)] no-select"
        >
            {tabs.map((tab, index) => {
                const isActive = tab.id === activeId;
                const isDropTarget = overIndex === index && dragIndex !== null && dragIndex !== index;
                return (
                    <div
                        key={tab.id}
                        ref={(el) => {
                            if (el) tabRefs.current.set(tab.id, el);
                            else tabRefs.current.delete(tab.id);
                        }}
                        role="tab"
                        aria-selected={isActive}
                        tabIndex={isActive ? 0 : -1}
                        title={tab.name}
                        draggable={!!onReorder}
                        onKeyDown={(e) => onKeyDown(e, index)}
                        onDragStart={(e) => {
                            setDragIndex(index);
                            e.dataTransfer.effectAllowed = "move";
                            // Firefox requires data to be set for a drag to start.
                            e.dataTransfer.setData("text/plain", tab.id);
                        }}
                        onDragOver={(e) => {
                            if (dragIndex === null) return;
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                            if (overIndex !== index) setOverIndex(index);
                        }}
                        onDrop={(e) => {
                            e.preventDefault();
                            if (dragIndex !== null && dragIndex !== index) onReorder?.(dragIndex, index);
                            setDragIndex(null);
                            setOverIndex(null);
                        }}
                        onDragEnd={() => { setDragIndex(null); setOverIndex(null); }}
                        onMouseDown={(e) => {
                            // Middle-click closes, like a browser.
                            if (e.button === 1) { e.preventDefault(); onClose(tab.id); }
                            else if (e.button === 0) onSelect(tab.id);
                        }}
                        onContextMenu={(e) => {
                            if (!onContextMenu) return;
                            e.preventDefault();
                            onContextMenu(tab.id, e.clientX, e.clientY);
                        }}
                        className={`group/tab relative flex items-center gap-2 pl-3 pr-2 shrink-0 min-w-[110px] max-w-[200px] cursor-pointer border-r border-[var(--border)] transition-colors outline-none ${
                            isActive
                                ? "bg-[var(--bg-primary)] text-[var(--text-primary)]"
                                : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
                        } ${isDropTarget ? "ring-1 ring-inset ring-[var(--accent)]" : ""}`}
                    >
                        {/* Active-tab top accent */}
                        {isActive && <span className="absolute left-0 top-0 h-[2px] w-full bg-[var(--accent)]" aria-hidden="true" />}
                        <span className="material-symbols-outlined text-[14px] shrink-0 opacity-70">description</span>
                        <span className="truncate text-xs">{tab.label}</span>
                        {/* Dirty dot doubles as the close target on hover. */}
                        <button
                            onMouseDown={(e) => { e.stopPropagation(); }}
                            onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
                            tabIndex={-1}
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
