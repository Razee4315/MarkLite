import { useState, useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { streamChat, buildAskMessages, buildAgentMessages, parseEdits, type ChatMessage } from "../utils/aiChat";
import type { AIConfig } from "../utils/aiAssist";

interface AIPanelProps {
    isOpen: boolean;
    onClose: () => void;
    /** Current document text. */
    note: string;
    fileName: string;
    /** Currently-selected text in the editor, if any. */
    selectionText: string;
    aiConfig: AIConfig;
    /** Called (Agent mode) with the proposed document to review in the editor. */
    onProposeEdit?: (proposedDoc: string) => void;
}

interface UIMessage {
    role: "user" | "assistant";
    content: string;
}

// Keep the last N turns as conversation context (token efficiency — the document
// itself is attached only to the latest turn inside buildAskMessages).
const MAX_HISTORY_TURNS = 8;

export function AIPanel({ isOpen, onClose, note, fileName, selectionText, aiConfig, onProposeEdit }: AIPanelProps) {
    const [messages, setMessages] = useState<UIMessage[]>([]);
    const [input, setInput] = useState("");
    const [mode, setMode] = useState<"ask" | "agent">("ask");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const configured = !!aiConfig.endpoint && !!aiConfig.model;

    useEffect(() => { if (isOpen) inputRef.current?.focus(); }, [isOpen]);
    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [messages]);
    useEffect(() => () => abortRef.current?.abort(), []);

    // Auto-grow the composer as the user types more lines (up to a max, then
    // scroll). Without this the single-row textarea just scrolls internally and
    // hides earlier lines. Reset to one row when cleared.
    const AI_INPUT_MAX_PX = 168;
    useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.style.height = "auto";
        el.style.height = Math.min(el.scrollHeight, AI_INPUT_MAX_PX) + "px";
        el.style.overflowY = el.scrollHeight > AI_INPUT_MAX_PX ? "auto" : "hidden";
    }, [input]);

    const send = useCallback(async () => {
        const text = input.trim();
        if (!text || busy) return;
        if (!configured) { setError("Configure an AI endpoint in Settings → AI first."); return; }
        setError(null);
        setInput("");

        // Prior turns as plain Q/A (no document) — the doc is attached only to the
        // newest user turn by buildAskMessages.
        const history: ChatMessage[] = messages
            .slice(-MAX_HISTORY_TURNS * 2)
            .map((m) => ({ role: m.role, content: m.content }));

        const withUser: UIMessage[] = [...messages, { role: "user", content: text }, { role: "assistant", content: "" }];
        const assistantIdx = withUser.length - 1;
        setMessages(withUser);
        setBusy(true);

        const ctrl = new AbortController();
        abortRef.current = ctrl;
        try {
            const msgs = mode === "agent"
                ? buildAgentMessages(history, note, selectionText, text)
                : buildAskMessages(history, note, selectionText, text);
            const full = await streamChat(msgs, aiConfig, {
                signal: ctrl.signal,
                onToken: (delta) => {
                    setMessages((prev) => {
                        const copy = prev.slice();
                        const cur = copy[assistantIdx];
                        if (cur) copy[assistantIdx] = { role: "assistant", content: cur.content + delta };
                        return copy;
                    });
                },
            });
            // Agent mode: if the reply was edit blocks, apply them and hand the
            // proposed document to the editor for review (replacing the raw blocks
            // that briefly streamed into the bubble with a clean summary).
            if (mode === "agent") {
                const res = parseEdits(full, note);
                if (res.hasEdits) {
                    let summary: string;
                    if (res.applied > 0) {
                        onProposeEdit?.(res.proposedDoc);
                        summary = `${res.explanation ? res.explanation + "\n\n" : ""}**Proposed ${res.applied} change${res.applied !== 1 ? "s" : ""}.** Review and Accept/Reject them in the editor.${res.failed ? `\n\n⚠️ ${res.failed} change${res.failed !== 1 ? "s" : ""} couldn't be applied — the text may have shifted. Try again.` : ""}`;
                    } else {
                        summary = "I drafted changes but none matched the current document (it may have changed since). Please try again.";
                    }
                    setMessages((prev) => {
                        const copy = prev.slice();
                        if (copy[assistantIdx]) copy[assistantIdx] = { role: "assistant", content: summary };
                        return copy;
                    });
                }
                // No edit blocks → it was an answer; the streamed text stays as-is.
            }
        } catch (e) {
            if ((e as Error).name !== "AbortError") setError((e as Error).message);
            // Drop the empty assistant bubble if nothing streamed in.
            setMessages((prev) => (prev[assistantIdx]?.content ? prev : prev.slice(0, assistantIdx)));
        } finally {
            setBusy(false);
            abortRef.current = null;
        }
    }, [input, busy, configured, messages, note, selectionText, aiConfig, mode, onProposeEdit]);

    const stop = useCallback(() => abortRef.current?.abort(), []);
    const clear = useCallback(() => { abortRef.current?.abort(); setMessages([]); setError(null); }, []);

    if (!isOpen) return null;

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    };

    return (
        <aside
            role="complementary"
            aria-label="AI assistant"
            className="fixed right-0 top-12 bottom-7 w-[400px] max-w-[90vw] z-50 flex flex-col bg-[var(--bg-secondary)] border-l border-[var(--border)] shadow-2xl"
        >
            {/* Header */}
            <div className="h-10 shrink-0 px-3 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-titlebar)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] no-select tracking-tight">
                    <span>AI Assistant</span>
                </div>
                <div className="flex items-center gap-1">
                    {messages.length > 0 && (
                        <button onClick={clear} title="New chat" aria-label="New chat" className="w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors">
                            <span className="material-symbols-outlined text-[18px]">add_comment</span>
                        </button>
                    )}
                    <button onClick={onClose} title="Close" aria-label="Close AI panel" className="w-7 h-7 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] flex items-center justify-center transition-colors">
                        <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                </div>
            </div>

            {/* Context indicator + Ask/Agent mode toggle */}
            <div className="px-3 py-1.5 shrink-0 border-b border-[var(--border-subtle)] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[13px] text-[var(--text-muted)]">description</span>
                <span className="truncate text-[11px] text-[var(--text-muted)] min-w-0">{fileName || "Untitled"}</span>
                {selectionText.trim() && (
                    <span className="px-1.5 py-0.5 rounded bg-[var(--bg-hover)] text-[var(--accent)] text-[11px] shrink-0">selection</span>
                )}
                <div className="ml-auto flex items-center gap-0.5 bg-[var(--bg-input)] rounded-[var(--radius-sm)] p-0.5 border border-[var(--border-subtle)] shrink-0">
                    {(["ask", "agent"] as const).map((md) => (
                        <button
                            key={md}
                            onClick={() => setMode(md)}
                            title={md === "ask" ? "Ask questions (read-only)" : "Make edits (review before applying)"}
                            className={`px-2 py-0.5 text-[11px] rounded-[var(--radius-sm)] capitalize transition-colors ${mode === md ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"}`}
                        >
                            {md}
                        </button>
                    ))}
                </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto px-3 py-3 space-y-3">
                {!configured ? (
                    <div className="flex flex-col items-center justify-center h-full text-center gap-3 text-sm text-[var(--text-secondary)]">
                        <span className="material-symbols-outlined text-[32px] opacity-40">key</span>
                        <p>Connect an AI provider to start chatting about your note.</p>
                        <button
                            onClick={() => window.dispatchEvent(new CustomEvent("marklite:open-settings"))}
                            className="px-3 py-1.5 text-sm rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-text)] hover:opacity-90"
                        >
                            Open AI settings
                        </button>
                    </div>
                ) : messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center gap-1.5 px-6">
                        <p className="text-sm font-medium text-[var(--text-primary)]">
                            {mode === "agent" ? "What should I change?" : "Ask about this note"}
                        </p>
                        <p className="text-xs text-[var(--text-muted)] leading-relaxed">
                            {mode === "agent"
                                ? "I'll propose edits you can review and accept."
                                : "Summaries, questions, suggestions — anything."}
                        </p>
                    </div>
                ) : (
                    messages.map((m, i) => (
                        <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                            {m.role === "user" ? (
                                <div className="max-w-[85%] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-text)] text-sm whitespace-pre-wrap break-words">
                                    {m.content}
                                </div>
                            ) : (
                                <div className="max-w-[92%] px-3 py-2 rounded-[var(--radius-md)] bg-[var(--bg-input)] border border-[var(--border-subtle)] text-sm w-full">
                                    {m.content ? (
                                        <div className="markdown-body !text-sm [&_*]:!text-sm [&_h1]:!text-base [&_h2]:!text-sm [&_pre]:!text-xs">
                                            <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                                        </div>
                                    ) : (
                                        <span className="inline-flex gap-1 text-[var(--text-muted)]">
                                            <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                                            Thinking…
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    ))
                )}
                {error && (
                    <div className="px-3 py-2 text-xs text-[var(--danger)] bg-[var(--danger)]/10 rounded-[var(--radius-sm)] whitespace-pre-wrap">{error}</div>
                )}
            </div>

            {/* Input */}
            {configured && (
                <div className="shrink-0 p-3 pt-2">
                    <div className="ai-composer flex items-end gap-2 bg-[var(--bg-input)] border border-[var(--border)] rounded-[var(--radius-lg)] px-3 py-2 shadow-sm transition-all duration-150">
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={onKeyDown}
                            rows={1}
                            placeholder={mode === "agent" ? "Describe the change…" : "Ask about this note…"}
                            className="flex-1 block w-full bg-transparent text-sm leading-relaxed text-[var(--text-primary)] outline-none focus:outline-none focus-visible:outline-none resize-none placeholder:text-[var(--text-muted)] py-0.5"
                        />
                        {busy ? (
                            <button onClick={stop} title="Stop" aria-label="Stop generating" className="shrink-0 w-8 h-8 rounded-[var(--radius-md)] bg-[var(--bg-hover)] text-[var(--text-primary)] flex items-center justify-center hover:bg-[var(--border)] transition-colors">
                                <span className="material-symbols-outlined text-[18px]">stop</span>
                            </button>
                        ) : (
                            <button onClick={send} disabled={!input.trim()} title="Send (Enter)" aria-label="Send" className="shrink-0 w-8 h-8 rounded-[var(--radius-md)] bg-[var(--accent)] text-[var(--accent-text)] flex items-center justify-center enabled:hover:opacity-90 enabled:active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed">
                                <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
                            </button>
                        )}
                    </div>
                    <p className="px-1 pt-1.5 text-[10px] text-[var(--text-muted)] no-select">
                        <kbd className="font-sans">Enter</kbd> to send · <kbd className="font-sans">Shift+Enter</kbd> for newline
                    </p>
                </div>
            )}
        </aside>
    );
}
