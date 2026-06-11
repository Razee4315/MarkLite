import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getSkippedUpdateVersion, setSkippedUpdateVersion } from "../utils/persistence";

type Phase = "available" | "downloading" | "installed" | "error";

/**
 * Checks GitHub Releases (latest.json) once on startup and, if a newer signed
 * build exists, offers Update / Skip-this-version / Later. "Skip" is remembered
 * per version; "Later" just dismisses until the next launch. The check is
 * silent on failure — dev builds and offline machines must never see an error
 * popup they can't act on.
 */
export function UpdateDialog() {
    const [update, setUpdate] = useState<Update | null>(null);
    const [phase, setPhase] = useState<Phase>("available");
    // 0..1 once the content length is known; -1 = indeterminate.
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const upd = await check();
                if (cancelled || !upd) return;
                if (getSkippedUpdateVersion() === upd.version) return;
                setUpdate(upd);
            } catch {
                /* offline / dev build without updater config — stay silent */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (!update) return null;

    const dismiss = () => setUpdate(null);

    const skipVersion = () => {
        setSkippedUpdateVersion(update.version);
        dismiss();
    };

    const install = async () => {
        setPhase("downloading");
        let total = 0;
        let received = 0;
        try {
            await update.downloadAndInstall((event) => {
                if (event.event === "Started") {
                    total = event.data.contentLength ?? 0;
                    setProgress(total ? 0 : -1);
                } else if (event.event === "Progress") {
                    received += event.data.chunkLength;
                    if (total) setProgress(Math.min(received / total, 1));
                } else if (event.event === "Finished") {
                    setProgress(1);
                }
            });
            setPhase("installed");
            await relaunch();
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            setPhase("error");
        }
    };

    const busy = phase === "downloading" || phase === "installed";

    return (
        <div className="fixed inset-0 z-[120] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Update available">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

            <div className="relative z-10 w-[440px] max-w-[92vw] max-h-[90vh] overflow-y-auto bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl animate-fade-in">
                <div className="px-5 pt-5 pb-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 shrink-0 rounded-[var(--radius-md)] bg-[var(--bg-hover)] flex items-center justify-center">
                            <span className="material-symbols-outlined text-[22px] text-[var(--accent)]">system_update_alt</span>
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-base font-semibold text-[var(--text-primary)]">Update available</h2>
                            <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                                Paperling <span className="font-semibold text-[var(--text-primary)]">v{update.version}</span> is ready
                                — you're on v{update.currentVersion}.
                            </p>
                        </div>
                    </div>

                    {update.body && phase === "available" && (
                        <div className="mt-3 max-h-36 overflow-y-auto px-3 py-2 text-[12px] leading-relaxed text-[var(--text-secondary)] whitespace-pre-wrap bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-[var(--radius-md)]">
                            {update.body}
                        </div>
                    )}

                    {busy && (
                        <div className="mt-4">
                            <div className="h-1.5 w-full rounded-full bg-[var(--bg-hover)] overflow-hidden">
                                <div
                                    className={`h-full rounded-full bg-[var(--accent)] transition-[width] duration-200 ${progress < 0 ? "w-full animate-pulse" : ""}`}
                                    style={progress >= 0 ? { width: `${Math.round(progress * 100)}%` } : undefined}
                                />
                            </div>
                            <p className="mt-2 text-[12px] text-[var(--text-muted)]">
                                {phase === "installed"
                                    ? "Installed — restarting…"
                                    : progress >= 0
                                        ? `Downloading… ${Math.round(progress * 100)}%`
                                        : "Downloading…"}
                            </p>
                        </div>
                    )}

                    {phase === "error" && (
                        <p className="mt-3 text-[12px] text-[var(--danger)] break-words">
                            Update failed: {error}
                        </p>
                    )}
                </div>

                {!busy && (
                <div className="flex items-center justify-end gap-2 px-5 py-3 bg-[var(--bg-secondary)] border-t border-[var(--border)]">
                    {phase === "available" && (
                        <>
                            <button
                                type="button"
                                onClick={skipVersion}
                                className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
                            >
                                Skip this version
                            </button>
                            <button
                                type="button"
                                onClick={dismiss}
                                className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                            >
                                Later
                            </button>
                            <button
                                type="button"
                                onClick={install}
                                className="px-3.5 py-1.5 text-sm font-medium rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90 transition-opacity"
                            >
                                Update now
                            </button>
                        </>
                    )}
                    {phase === "error" && (
                        <button
                            type="button"
                            onClick={dismiss}
                            className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
                        >
                            Close
                        </button>
                    )}
                </div>
                )}
            </div>
        </div>
    );
}
