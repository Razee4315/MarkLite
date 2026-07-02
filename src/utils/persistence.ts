/**
 * localStorage-backed persistence for app state across sessions.
 * Tauri's webview has localStorage available; values survive app restarts.
 */

// One-time migration from the app's pre-rename key prefix. The bundle
// identifier (and therefore the WebView2 storage location) is unchanged, so
// existing users still have their old "marklite:*" entries — copy each to its
// "paperling:*" name once, then drop the original. Runs at module load,
// before any getter seeds React state. Exported for tests.
export function migrateLegacyKeys(): void {
    try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
            const key = localStorage.key(i);
            if (!key || !key.startsWith("marklite:")) continue;
            const renamed = "paperling:" + key.slice("marklite:".length);
            const value = localStorage.getItem(key);
            if (value !== null && localStorage.getItem(renamed) === null) {
                localStorage.setItem(renamed, value);
            }
            localStorage.removeItem(key);
        }
    } catch { /* storage unavailable — nothing to migrate */ }
}
migrateLegacyKeys();

const KEY_RECENT_FILES = "paperling:recentFiles";
const KEY_LAST_FILE = "paperling:lastFile";
const KEY_VIEW_MODE = "paperling:viewMode";
const KEY_SPLIT_RATIO = "paperling:splitRatio";

// Multi-file/tab workflows make 10 feel tight; 25 keeps the palette's recents
// useful without unbounded growth.
const MAX_RECENT = 25;

const safeGet = <T>(key: string, fallback: T): T => {
    try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : (JSON.parse(raw) as T);
    } catch {
        return fallback;
    }
};

const safeSet = (key: string, value: unknown): void => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {/* storage may be full / disabled */}
};

export interface RecentFile {
    path: string;
    name: string;
    openedAt: number;
}

export const getRecentFiles = (): RecentFile[] => safeGet<RecentFile[]>(KEY_RECENT_FILES, []);

export const addRecentFile = (path: string, name: string): RecentFile[] => {
    const list = getRecentFiles().filter((f) => f.path !== path);
    list.unshift({ path, name, openedAt: Date.now() });
    const trimmed = list.slice(0, MAX_RECENT);
    safeSet(KEY_RECENT_FILES, trimmed);
    return trimmed;
};

export const removeRecentFile = (path: string): RecentFile[] => {
    const list = getRecentFiles().filter((f) => f.path !== path);
    safeSet(KEY_RECENT_FILES, list);
    return list;
};

export const clearRecentFiles = (): void => safeSet(KEY_RECENT_FILES, []);

export const getLastFile = (): string | null => safeGet<string | null>(KEY_LAST_FILE, null);
export const setLastFile = (path: string | null): void => safeSet(KEY_LAST_FILE, path);

// Full multi-tab session, so a relaunch reopens every tab the user had — not
// just the single last file. Only files with a path are stored (untitled
// buffers have no content persisted here); `activeIndex` points into `tabs`.
// getLastFile stays as a migration fallback for sessions saved before this. TABS-07.
const KEY_SESSION = "paperling:session";
export interface SessionTab {
    path: string;
    /** 1-based caret/scroll line to restore. */
    cursorLine?: number;
}
export interface SessionState {
    tabs: SessionTab[];
    activeIndex: number;
}
export const getSession = (): SessionState | null => {
    const s = safeGet<SessionState | null>(KEY_SESSION, null);
    if (!s || !Array.isArray(s.tabs)) return null;
    // Defend against a malformed/hand-edited value.
    const tabs = s.tabs.filter((t): t is SessionTab => !!t && typeof t.path === "string");
    if (tabs.length === 0) return null;
    const activeIndex = Number.isInteger(s.activeIndex) ? Math.min(Math.max(0, s.activeIndex), tabs.length - 1) : 0;
    return { tabs, activeIndex };
};
export const setSession = (s: SessionState | null): void => safeSet(KEY_SESSION, s);

export const getSavedViewMode = (): "preview" | "code" | "split" =>
    safeGet<"preview" | "code" | "split">(KEY_VIEW_MODE, "preview");
export const setSavedViewMode = (m: "preview" | "code" | "split"): void => safeSet(KEY_VIEW_MODE, m);

export const getSplitRatio = (): number => {
    const r = safeGet<number>(KEY_SPLIT_RATIO, 0.5);
    return Number.isFinite(r) && r > 0.15 && r < 0.85 ? r : 0.5;
};
export const setSplitRatio = (r: number): void => safeSet(KEY_SPLIT_RATIO, r);

const KEY_TOUR_DONE = "paperling:tourDone";
export const getTourDone = (): boolean => safeGet<boolean>(KEY_TOUR_DONE, false);
export const setTourDone = (v: boolean): void => safeSet(KEY_TOUR_DONE, v);

const KEY_TYPEWRITER_MODE = "paperling:typewriterMode";
const KEY_TOOLBAR = "paperling:toolbar";
const KEY_WORD_WRAP = "paperling:wordWrap";
const KEY_SPELL_CHECK = "paperling:spellCheck";
export const getTypewriterMode = (): boolean => safeGet<boolean>(KEY_TYPEWRITER_MODE, false);
export const setTypewriterMode = (v: boolean): void => safeSet(KEY_TYPEWRITER_MODE, v);
export const getToolbarEnabled = (): boolean => safeGet<boolean>(KEY_TOOLBAR, false);
export const setToolbarEnabled = (v: boolean): void => safeSet(KEY_TOOLBAR, v);
export const getWordWrap = (): boolean => safeGet<boolean>(KEY_WORD_WRAP, true);
export const setWordWrap = (v: boolean): void => safeSet(KEY_WORD_WRAP, v);
export const getSpellCheck = (): boolean => safeGet<boolean>(KEY_SPELL_CHECK, false);
export const setSpellCheck = (v: boolean): void => safeSet(KEY_SPELL_CHECK, v);

const KEY_AUTO_SAVE = "paperling:autoSave";
export const getAutoSave = (): boolean => safeGet<boolean>(KEY_AUTO_SAVE, false);
export const setAutoSave = (v: boolean): void => safeSet(KEY_AUTO_SAVE, v);

// Master switch for every AI surface (title-bar button, side panel, toolbar
// sparkle, Alt+J, command palette entry). On by default; flipped in Settings.
const KEY_AI_ENABLED = "paperling:aiEnabled";
export const getAIEnabled = (): boolean => safeGet<boolean>(KEY_AI_ENABLED, true);
export const setAIEnabled = (v: boolean): void => safeSet(KEY_AI_ENABLED, v);

// Version the user chose to skip in the update popup, so we don't nag about
// it on every launch. A newer release has a different version string and
// prompts again.
const KEY_SKIPPED_UPDATE = "paperling:skippedUpdateVersion";
export const getSkippedUpdateVersion = (): string | null =>
    safeGet<string | null>(KEY_SKIPPED_UPDATE, null);
export const setSkippedUpdateVersion = (v: string): void => safeSet(KEY_SKIPPED_UPDATE, v);

const KEY_AI_ENDPOINT = "paperling:aiEndpoint";
const KEY_AI_MODEL = "paperling:aiModel";
const KEY_AI_API_KEY = "paperling:aiApiKey";

// AI API key now lives in the OS keychain (SECURITY-01), accessed via the
// get_ai_key / set_ai_key Tauri commands. To keep getAIConfig() synchronous (it
// seeds React useState initializers), the key is mirrored into a module cache
// that initAIKey() hydrates once at startup. A localStorage fallback covers
// environments without a keychain (e.g. a headless Linux box) so AI never
// silently breaks.
let cachedAIKey = "";
let aiKeyLoaded = false;

export async function initAIKey(): Promise<void> {
    if (aiKeyLoaded) return;
    aiKeyLoaded = true;
    try {
        const { invoke } = await import("@tauri-apps/api/core");
        cachedAIKey = await invoke<string>("get_ai_key");
        // One-time migration: move any legacy plaintext key into the keychain.
        if (!cachedAIKey) {
            const legacy = safeGet<string>(KEY_AI_API_KEY, "");
            if (legacy) {
                cachedAIKey = legacy;
                try {
                    await invoke("set_ai_key", { key: legacy });
                    localStorage.removeItem(KEY_AI_API_KEY);
                } catch {/* keychain unavailable — leave the localStorage copy */}
            }
        }
    } catch {
        // No keychain available — fall back to the legacy localStorage value.
        cachedAIKey = safeGet<string>(KEY_AI_API_KEY, "");
    }
}

export const getAIConfig = (): { endpoint: string; model: string; apiKey: string } => ({
    endpoint: safeGet<string>(KEY_AI_ENDPOINT, ""),
    model: safeGet<string>(KEY_AI_MODEL, ""),
    // Prefer the hydrated keychain value; fall back to a (legacy) localStorage
    // key before initAIKey() has resolved or when no keychain is present.
    apiKey: cachedAIKey || safeGet<string>(KEY_AI_API_KEY, ""),
});

export const setAIConfig = (cfg: { endpoint: string; model: string; apiKey: string }): void => {
    safeSet(KEY_AI_ENDPOINT, cfg.endpoint);
    safeSet(KEY_AI_MODEL, cfg.model);
    cachedAIKey = cfg.apiKey;
    // Persist the key to the OS keychain; on failure fall back to localStorage so
    // the setting still survives a restart.
    import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("set_ai_key", { key: cfg.apiKey }))
        .then(() => { try { localStorage.removeItem(KEY_AI_API_KEY); } catch {/* ignore */} })
        .catch(() => safeSet(KEY_AI_API_KEY, cfg.apiKey));
};
