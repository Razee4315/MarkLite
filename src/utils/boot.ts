/**
 * Decides which file the app should open on launch.
 *
 * Priority is the whole bug fix: a file the user just double-clicked in the
 * OS (CLI arg) must always beat the last-session restore. The old design
 * raced a delayed backend event against the restore and sometimes lost,
 * reopening yesterday's file instead of the one the user clicked.
 */
export type BootSource = "cli" | "last" | "none";

export interface BootTarget {
    path: string | null;
    source: BootSource;
}

export function pickBootFile(cliFile: string | null, lastFile: string | null): BootTarget {
    if (cliFile) return { path: cliFile, source: "cli" };
    if (lastFile) return { path: lastFile, source: "last" };
    return { path: null, source: "none" };
}
