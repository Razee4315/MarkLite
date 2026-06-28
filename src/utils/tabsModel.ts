/**
 * Pure data model for the open-file tabs. The heavy state lives in App (the
 * "active" tab is the live editor); these helpers just manage the list so the
 * tricky bits (which tab to focus after a close) are unit-testable.
 */

export interface TabState {
  /** Stable id for the lifetime of the tab (unrelated to the file path). */
  id: string;
  /** null for an unsaved "Untitled" buffer. */
  filePath: string | null;
  fileName: string;
  content: string;
  originalContent: string;
  fileSize: number;
  /** Last-known on-disk mtime (ms), for external-change detection. */
  knownMtime: number;
}

/** A tab is dirty when its buffer differs from what's on disk. */
export function isTabDirty(tab: Pick<TabState, "content" | "originalContent">): boolean {
  return tab.content !== tab.originalContent;
}

/** Find an open tab by file path (null paths never match). */
export function findTabByPath(tabs: TabState[], path: string | null): TabState | undefined {
  if (path == null) return undefined;
  return tabs.find((t) => t.filePath === path);
}

/**
 * Which tab should become active after `closingId` is closed: the tab to the
 * right (the one that slides into the closed slot), else the tab to the left,
 * else null when nothing remains. Mirrors common editor behaviour.
 */
export function nextActiveAfterClose(tabs: TabState[], closingId: string): string | null {
  const idx = tabs.findIndex((t) => t.id === closingId);
  if (idx === -1) return null;
  const remaining = tabs.filter((t) => t.id !== closingId);
  if (remaining.length === 0) return null;
  return (remaining[idx] ?? remaining[idx - 1] ?? remaining[remaining.length - 1]).id;
}
