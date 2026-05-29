/**
 * localStorage-backed persistence for app state across sessions.
 * Tauri's webview has localStorage available; values survive app restarts.
 */

const KEY_RECENT_FILES = "marklite:recentFiles";
const KEY_LAST_FILE = "marklite:lastFile";
const KEY_VIEW_MODE = "marklite:viewMode";
const KEY_SPLIT_RATIO = "marklite:splitRatio";

const MAX_RECENT = 10;

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

export const getSavedViewMode = (): "preview" | "code" | "split" =>
    safeGet<"preview" | "code" | "split">(KEY_VIEW_MODE, "preview");
export const setSavedViewMode = (m: "preview" | "code" | "split"): void => safeSet(KEY_VIEW_MODE, m);

export const getSplitRatio = (): number => {
    const r = safeGet<number>(KEY_SPLIT_RATIO, 0.5);
    return Number.isFinite(r) && r > 0.15 && r < 0.85 ? r : 0.5;
};
export const setSplitRatio = (r: number): void => safeSet(KEY_SPLIT_RATIO, r);

const KEY_TYPEWRITER_MODE = "marklite:typewriterMode";
const KEY_TOOLBAR = "marklite:toolbar";
const KEY_WORD_WRAP = "marklite:wordWrap";
const KEY_SPELL_CHECK = "marklite:spellCheck";
export const getTypewriterMode = (): boolean => safeGet<boolean>(KEY_TYPEWRITER_MODE, false);
export const setTypewriterMode = (v: boolean): void => safeSet(KEY_TYPEWRITER_MODE, v);
export const getToolbarEnabled = (): boolean => safeGet<boolean>(KEY_TOOLBAR, false);
export const setToolbarEnabled = (v: boolean): void => safeSet(KEY_TOOLBAR, v);
export const getWordWrap = (): boolean => safeGet<boolean>(KEY_WORD_WRAP, true);
export const setWordWrap = (v: boolean): void => safeSet(KEY_WORD_WRAP, v);
export const getSpellCheck = (): boolean => safeGet<boolean>(KEY_SPELL_CHECK, false);
export const setSpellCheck = (v: boolean): void => safeSet(KEY_SPELL_CHECK, v);

const KEY_AI_ENDPOINT = "marklite:aiEndpoint";
const KEY_AI_MODEL = "marklite:aiModel";
const KEY_AI_API_KEY = "marklite:aiApiKey";

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
