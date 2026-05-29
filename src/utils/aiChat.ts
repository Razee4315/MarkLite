/**
 * Streaming chat client for the AI panel — talks to the same OpenAI-compatible
 * endpoint as aiAssist (OpenAI, Gemini's OpenAI-compat layer, Ollama, etc.) but
 * with `stream: true` so the panel can render tokens as they arrive.
 */

import type { AIConfig } from "./aiAssist";

export type ChatRole = "system" | "user" | "assistant";
export interface ChatMessage {
    role: ChatRole;
    content: string;
}

const AI_CONNECT_TIMEOUT_MS = 120_000;

function mapHttpError(status: number, body: string): string {
    const detail = body.trim().slice(0, 200);
    let msg: string;
    if (status === 401 || status === 403) msg = "API key invalid or unauthorized — check Settings → AI.";
    else if (status === 404) msg = "Endpoint not found (404) — check the URL in Settings → AI.";
    else if (status === 429) msg = "Rate limited (429) — wait a moment and try again.";
    else if (status >= 500) msg = `AI service unavailable (${status}). Try again later.`;
    else msg = `AI request failed (${status}).`;
    return detail ? `${msg}\n${detail}` : msg;
}

/** Pull assistant text from a non-streamed completion (OpenAI or Ollama shape). */
function extractContent(data: unknown): string {
    const d = data as { choices?: Array<{ message?: { content?: string } }>; message?: { content?: string } };
    return d?.choices?.[0]?.message?.content ?? d?.message?.content ?? "";
}

/**
 * Stream a chat completion. Calls `onToken` with each incremental delta and
 * resolves with the full text. Aborts cleanly via `opts.signal`.
 */
export async function streamChat(
    messages: ChatMessage[],
    cfg: AIConfig,
    opts: { signal?: AbortSignal; onToken?: (delta: string) => void; temperature?: number } = {}
): Promise<string> {
    if (!cfg.endpoint) throw new Error("AI endpoint not configured. Open Settings → AI to set one up.");
    if (!cfg.model) throw new Error("AI model not configured.");

    const ctrl = new AbortController();
    const onUserAbort = () => ctrl.abort();
    opts.signal?.addEventListener("abort", onUserAbort);
    // Guards only the initial connection; cleared once the response headers
    // arrive so a long generation isn't cut off mid-stream.
    const connectTimeout = window.setTimeout(() => ctrl.abort(), AI_CONNECT_TIMEOUT_MS);

    try {
        const res = await fetch(cfg.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
            },
            body: JSON.stringify({
                model: cfg.model,
                messages,
                temperature: opts.temperature ?? 0.4,
                stream: true,
            }),
            signal: ctrl.signal,
        });
        window.clearTimeout(connectTimeout);

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            throw new Error(mapHttpError(res.status, body));
        }

        // Endpoint ignored `stream` (or returned no body) — read the whole thing.
        if (!res.body) {
            const data = await res.json();
            const content = extractContent(data);
            if (content) opts.onToken?.(content);
            return content;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let full = "";
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            // Process complete SSE lines; keep any trailing partial line buffered.
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (payload === "[DONE]") continue;
                try {
                    const json = JSON.parse(payload);
                    const delta: string = json?.choices?.[0]?.delta?.content ?? "";
                    if (delta) {
                        full += delta;
                        opts.onToken?.(delta);
                    }
                } catch {
                    /* partial JSON across chunk boundary — completed on next read */
                }
            }
        }
        return full;
    } finally {
        window.clearTimeout(connectTimeout);
        opts.signal?.removeEventListener("abort", onUserAbort);
    }
}

// ===== Prompt + message construction =====
//
// Token efficiency: the (possibly large) document is included only in the LATEST
// user turn — never duplicated through the conversation history. Prior turns are
// just the plain Q/A text. The caller trims history length.

export const ASK_SYSTEM_PROMPT =
    "You are the writing assistant inside MarkLite, a Markdown editor. Answer the " +
    "user's questions about their current Markdown document clearly and concisely, " +
    "formatted in Markdown. This is a read-only Q&A mode — do not rewrite or output " +
    "the whole document unless explicitly asked.";

/** Wrap untrusted document text in tags (avoids colliding with the doc's own ``` fences). */
function asDocument(note: string): string {
    return `<document>\n${note}\n</document>`;
}

export function buildAskMessages(
    history: ChatMessage[],
    note: string,
    selection: string,
    userInput: string
): ChatMessage[] {
    const ctx = selection.trim()
        ? `Current document:\n${asDocument(note)}\n\nThe user has selected this passage:\n${asDocument(selection)}`
        : `Current document:\n${asDocument(note)}`;
    return [
        { role: "system", content: ASK_SYSTEM_PROMPT },
        ...history,
        { role: "user", content: `${ctx}\n\n---\nQuestion: ${userInput}` },
    ];
}
