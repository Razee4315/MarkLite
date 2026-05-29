import { useEffect, useRef, useState } from "react";
import { useTheme, type Theme, type FontFamily, type FontSize } from "../context/ThemeContext";
import {
    getTypewriterMode, setTypewriterMode,
    getToolbarEnabled, setToolbarEnabled,
    getAIConfig, setAIConfig,
    getWordWrap, setWordWrap,
    getSpellCheck, setSpellCheck,
} from "../utils/persistence";
import { attachFocusTrap } from "../utils/focusTrap";
import { isValidEndpoint, runAIAction } from "../utils/aiAssist";

// Platform-aware AI shortcut hint (Windows/Linux: Alt+J; macOS: ⌘J). Windows
// can't use Ctrl+J because WebView2 reserves it for its Downloads UI.
const IS_MAC = typeof navigator !== "undefined" && /mac/i.test(navigator.platform || navigator.userAgent || "");
const AI_SHORTCUT = IS_MAC ? "⌘J" : "Alt+J";

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

type Section = "appearance" | "editor" | "ai" | "about";

const sections: Array<{ id: Section; label: string; icon: string }> = [
    { id: "appearance", label: "Appearance", icon: "palette" },
    { id: "editor", label: "Editor", icon: "edit" },
    { id: "ai", label: "AI", icon: "auto_awesome" },
    { id: "about", label: "About", icon: "info" },
];

const themes: Array<{ id: Theme; name: string; colors: [string, string]; textColor: string; icon?: string }> = [
    { id: "dark", name: "Dark", colors: ["#0a0a0a", "#141414"], textColor: "#ffffff" },
    { id: "light", name: "Light", colors: ["#ffffff", "#f5f5f5"], textColor: "#171717" },
    { id: "paper", name: "Paper", colors: ["#f5f0e6", "#ebe5d8"], textColor: "#3d3d3d" },
    { id: "github", name: "GitHub", colors: ["#ffffff", "#f6f8fa"], textColor: "#1f2328", icon: "github" },
];

const fonts: Array<{ id: FontFamily; name: string }> = [
    { id: "inter", name: "Inter" },
    { id: "merriweather", name: "Merriweather" },
    { id: "lora", name: "Lora" },
    { id: "source-serif", name: "Source Serif" },
    { id: "fira-sans", name: "Fira Sans" },
];

const fontSizes: Array<{ id: FontSize; name: string }> = [
    { id: "small", name: "Small" },
    { id: "medium", name: "Medium" },
    { id: "large", name: "Large" },
];

interface ToggleRowProps {
    label: string;
    description: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="w-full flex items-center justify-between gap-4 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--bg-hover)] transition-colors text-left"
        >
            <div className="flex flex-col items-start min-w-0">
                <span className="text-sm text-[var(--text-primary)]">{label}</span>
                <span className="text-[11px] text-[var(--text-muted)]">{description}</span>
            </div>
            <span className={`relative inline-block w-9 h-5 rounded-full shrink-0 transition-colors ${checked ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : ""}`} />
            </span>
        </button>
    );
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
    const dialogRef = useRef<HTMLDivElement>(null);
    const [section, setSection] = useState<Section>("appearance");
    const [filter, setFilter] = useState("");
    const { theme, setTheme, font, setFont, fontSize, setFontSize } = useTheme();

    const [typewriter, setTypewriterLocal] = useState(getTypewriterMode);
    const [toolbar, setToolbarLocal] = useState(getToolbarEnabled);
    const [wordWrap, setWordWrapLocal] = useState(getWordWrap);
    const [spellCheck, setSpellCheckLocal] = useState(getSpellCheck);

    const [ai, setAi] = useState(getAIConfig);
    const aiEndpointInvalid = ai.endpoint.length > 0 && !isValidEndpoint(ai.endpoint);
    const aiConfigured = !!ai.endpoint && !aiEndpointInvalid && !!ai.model;

    // Connection-test state for the "Test connection" button (AI-04).
    const [aiTest, setAiTest] = useState<{ state: "idle" | "testing" | "ok" | "error"; msg?: string }>({ state: "idle" });

    // Update an AI field, clear any stale test result, and persist immediately
    // (when the endpoint is empty or valid) so edits survive a close-before-blur.
    const updateAi = (patch: Partial<typeof ai>) => {
        const next = { ...ai, ...patch };
        setAi(next);
        setAiTest({ state: "idle" });
        if (!next.endpoint || isValidEndpoint(next.endpoint)) setAIConfig(next);
    };

    const testAIConnection = async () => {
        setAiTest({ state: "testing" });
        try {
            await runAIAction("continue", "Reply with: OK", ai);
            setAiTest({ state: "ok" });
        } catch (e) {
            setAiTest({ state: "error", msg: (e as Error).message });
        }
    };

    const fire = (event: string, enabled: boolean) =>
        window.dispatchEvent(new CustomEvent(event, { detail: { enabled } }));

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKey);
        const detach = attachFocusTrap(dialogRef.current);
        return () => {
            document.removeEventListener("keydown", onKey);
            detach();
        };
    }, [isOpen, onClose]);

    // Persist AI fields on close. The endpoint/model/key inputs save on blur,
    // but Escape-to-close or backdrop-click can fire before the input loses
    // focus, dropping the in-flight edit. Refresh persistence on every close
    // transition so unblurred edits survive (only when the endpoint is valid;
    // an invalid URL is left unsaved so the user can fix it on next open).
    const aiRef = useRef(ai);
    aiRef.current = ai;
    useEffect(() => {
        if (isOpen) return; // only fire on open→close transition
        const current = aiRef.current;
        if (current.endpoint && !isValidEndpoint(current.endpoint)) return;
        setAIConfig(current);
    }, [isOpen]);

    if (!isOpen) return null;

    const matches = (text: string) => !filter || text.toLowerCase().includes(filter.toLowerCase());

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" role="dialog" aria-modal="true" aria-label="Settings">
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />

            <div
                ref={dialogRef}
                className="relative z-10 w-[820px] max-w-[95vw] h-[600px] max-h-[90vh] flex bg-[var(--bg-primary)] border border-[var(--border)] rounded-[var(--radius-lg)] shadow-2xl overflow-hidden animate-fade-in"
            >
                {/* Sidebar */}
                <aside className="w-48 shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col">
                    <div className="px-4 py-3 border-b border-[var(--border)]">
                        <input
                            type="text"
                            value={filter}
                            onChange={(e) => setFilter(e.target.value)}
                            placeholder="Search…"
                            aria-label="Search settings"
                            className="w-full px-2 py-1 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                        />
                    </div>
                    <nav className="flex-1 py-2">
                        {sections.map((s) => (
                            <button
                                key={s.id}
                                onClick={() => setSection(s.id)}
                                className={`w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors ${section === s.id
                                    ? "bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium"
                                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
                                    }`}
                            >
                                <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
                                {s.label}
                            </button>
                        ))}
                    </nav>
                </aside>

                {/* Body */}
                <div className="flex-1 flex flex-col min-w-0">
                    <header className="flex items-center justify-between px-6 py-3 border-b border-[var(--border)]">
                        <h2 className="text-base font-semibold text-[var(--text-primary)]">
                            {sections.find((s) => s.id === section)?.label ?? "Settings"}
                        </h2>
                        <button onClick={onClose} aria-label="Close settings" className="w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors">
                            <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                    </header>

                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                        {section === "appearance" && (
                            <>
                                {matches("theme") && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Theme</h3>
                                        <div className="grid grid-cols-4 gap-2">
                                            {themes.map((t) => (
                                                <button
                                                    key={t.id}
                                                    onClick={() => setTheme(t.id)}
                                                    className={`flex flex-col items-center gap-2 p-3 rounded-[var(--radius-md)] transition-all ${theme === t.id
                                                        ? "ring-2 ring-[var(--accent)] bg-[var(--bg-hover)]"
                                                        : "hover:bg-[var(--bg-hover)]"
                                                        }`}
                                                    title={t.name}
                                                >
                                                    <div className="w-12 h-12 rounded-[var(--radius-md)] overflow-hidden border border-[var(--border)] flex items-center justify-center" style={{ backgroundColor: t.colors[0] }}>
                                                        {t.icon === "github" ? (
                                                            <svg className="w-6 h-6" fill={t.textColor} viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                                                        ) : (
                                                            <>
                                                                <div className="w-1/2 h-full" style={{ backgroundColor: t.colors[0] }}></div>
                                                                <div className="w-1/2 h-full" style={{ backgroundColor: t.colors[1] }}></div>
                                                            </>
                                                        )}
                                                    </div>
                                                    <span className="text-[11px] text-[var(--text-primary)]">{t.name}</span>
                                                </button>
                                            ))}
                                        </div>
                                    </section>
                                )}
                                {matches("font") && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Font</h3>
                                        <div className="grid grid-cols-2 gap-2">
                                            {fonts.map((f) => (
                                                <button
                                                    key={f.id}
                                                    onClick={() => setFont(f.id)}
                                                    className={`px-3 py-2 rounded-[var(--radius-md)] text-sm text-left transition-colors ${font === f.id
                                                        ? "bg-[var(--accent)] text-[var(--accent-text)]"
                                                        : "hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                                                        }`}
                                                >{f.name}</button>
                                            ))}
                                        </div>
                                    </section>
                                )}
                                {matches("size") && (
                                    <section>
                                        <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">Font size</h3>
                                        <div className="flex gap-2">
                                            {fontSizes.map((s) => (
                                                <button
                                                    key={s.id}
                                                    onClick={() => setFontSize(s.id)}
                                                    className={`flex-1 px-3 py-2 rounded-[var(--radius-md)] text-sm transition-colors ${fontSize === s.id
                                                        ? "bg-[var(--accent)] text-[var(--accent-text)]"
                                                        : "hover:bg-[var(--bg-hover)] text-[var(--text-primary)]"
                                                        }`}
                                                >{s.name}</button>
                                            ))}
                                        </div>
                                    </section>
                                )}
                            </>
                        )}

                        {section === "editor" && (
                            <>
                                {matches("typewriter") && (
                                    <ToggleRow label="Typewriter mode" description="Keep caret vertically centered" checked={typewriter}
                                        onChange={(v) => { setTypewriterLocal(v); setTypewriterMode(v); fire("marklite:typewriter-toggle", v); }} />
                                )}
                                {matches("toolbar") && (
                                    <ToggleRow label="Show formatting toolbar" description="Toolbar above the editor" checked={toolbar}
                                        onChange={(v) => { setToolbarLocal(v); setToolbarEnabled(v); fire("marklite:toolbar-toggle", v); }} />
                                )}
                                {matches("word wrap") && (
                                    <ToggleRow label="Word wrap" description="Wrap long lines instead of horizontal scroll" checked={wordWrap}
                                        onChange={(v) => { setWordWrapLocal(v); setWordWrap(v); fire("marklite:wordwrap-toggle", v); }} />
                                )}
                                {matches("spell check") && (
                                    <ToggleRow label="Spell check" description="Underline misspelled words while you type" checked={spellCheck}
                                        onChange={(v) => { setSpellCheckLocal(v); setSpellCheck(v); fire("marklite:spellcheck-toggle", v); }} />
                                )}
                            </>
                        )}

                        {section === "ai" && (
                            <>
                                <div className="flex items-start justify-between gap-3">
                                    <p className="text-sm text-[var(--text-secondary)]">
                                        Configure an OpenAI-compatible endpoint to enable inline AI assist
                                        (Rewrite / Shorten / Expand / Continue / Translate). Open it in the editor
                                        with <kbd className="px-1 font-mono rounded border border-[var(--border)] bg-[var(--bg-input)]">{AI_SHORTCUT}</kbd>,
                                        the <span className="material-symbols-outlined text-[14px] align-middle">auto_awesome</span> toolbar button,
                                        or the command palette.
                                    </p>
                                    <span
                                        className={`shrink-0 px-2 py-0.5 rounded-[var(--radius-pill)] text-[11px] font-medium border ${aiEndpointInvalid
                                            ? "text-[var(--danger)] border-[var(--danger)]"
                                            : aiConfigured
                                                ? "text-[var(--status-saved)] border-[var(--status-saved)]"
                                                : "text-[var(--status-unsaved)] border-[var(--status-unsaved)]"
                                            }`}
                                    >
                                        {aiEndpointInvalid ? "Invalid endpoint" : aiConfigured ? "Ready" : "Not configured"}
                                    </span>
                                </div>
                                <div className="space-y-3">
                                    <label className="block">
                                        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Endpoint URL</span>
                                        <input
                                            type="url"
                                            value={ai.endpoint}
                                            onChange={(e) => updateAi({ endpoint: e.target.value })}
                                            placeholder="https://api.openai.com/v1/chat/completions"
                                            aria-invalid={aiEndpointInvalid}
                                            className={`mt-1 w-full px-3 py-2 text-sm bg-[var(--bg-input)] border rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none font-mono ${aiEndpointInvalid ? "border-[var(--danger)] focus:border-[var(--danger)]" : "border-[var(--border)] focus:border-[var(--accent)]"}`}
                                        />
                                        {aiEndpointInvalid && (
                                            <span className="block mt-1 text-[11px] text-[var(--danger)]">Must be a valid http:// or https:// URL.</span>
                                        )}
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Model</span>
                                        <input
                                            type="text"
                                            value={ai.model}
                                            onChange={(e) => updateAi({ model: e.target.value })}
                                            placeholder="gpt-4o-mini, claude-haiku-4-5, llama3, …"
                                            className="mt-1 w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-mono"
                                        />
                                    </label>
                                    <label className="block">
                                        <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">API key</span>
                                        <input
                                            type="password"
                                            value={ai.apiKey}
                                            onChange={(e) => updateAi({ apiKey: e.target.value })}
                                            placeholder="(optional for local providers)"
                                            className="mt-1 w-full px-3 py-2 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-md)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)] font-mono"
                                        />
                                    </label>
                                    <div className="flex items-center gap-3">
                                        <button
                                            type="button"
                                            onClick={testAIConnection}
                                            disabled={!aiConfigured || aiTest.state === "testing"}
                                            className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] border border-[var(--border)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 transition-colors"
                                        >
                                            {aiTest.state === "testing" ? "Testing…" : "Test connection"}
                                        </button>
                                        {aiTest.state === "ok" && (
                                            <span className="text-[12px] text-[var(--status-saved)]">✓ Connection OK</span>
                                        )}
                                        {aiTest.state === "error" && (
                                            <span className="text-[12px] text-[var(--danger)] truncate" title={aiTest.msg}>{aiTest.msg}</span>
                                        )}
                                    </div>
                                    <p className="text-[11px] text-[var(--text-muted)] leading-relaxed">
                                        <strong>Privacy:</strong> your selected text is sent <strong>unencrypted</strong> to the endpoint you configure above.
                                        For private notes, use a local provider (e.g. Ollama at <code>http://localhost:11434/v1/chat/completions</code>) so nothing leaves your machine.
                                        The API key is stored in your operating system's keychain (Windows Credential Manager, macOS Keychain, or Linux Secret Service), not in plaintext.
                                    </p>
                                </div>
                            </>
                        )}

                        {section === "about" && (
                            <div className="text-sm text-[var(--text-secondary)] space-y-2">
                                <div className="flex items-center gap-3">
                                    <img src="/icon.svg" alt="MarkLite" className="w-10 h-10" />
                                    <div>
                                        <div className="text-[var(--text-primary)] font-semibold">MarkLite</div>
                                        <div className="text-[11px]">A minimal markdown editor</div>
                                    </div>
                                </div>
                                <p>Built with Tauri + React + TypeScript.</p>
                                <p>Press <kbd className="px-1 font-mono rounded border border-[var(--border)] bg-[var(--bg-input)]">?</kbd> to view all keyboard shortcuts.</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
