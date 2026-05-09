import { useRef, useCallback, useEffect, useMemo, useState, memo, forwardRef } from "react";
import { getImageFromClipboard, saveImageToFile, createMarkdownImage, insertAtCursor } from "../utils/imageUtils";
import {
    handleTab,
    handleEnter,
    handleAutoPair,
    handleSkipCloser,
    handleBackspace,
    wrapSelection,
    insertLink,
    type EditorResult,
} from "../utils/editorActions";
import { FindReplaceBar } from "./FindReplaceBar";
import { FormatToolbar } from "./FormatToolbar";
import { SlashMenu, type SlashCommand } from "./SlashMenu";
import { AIBubble } from "./AIBubble";
import { pasteUrlOnSelection, pasteUrlAutolink, pasteTsvAsTable, htmlToMarkdown } from "../utils/smartPaste";
import type { Scroller } from "../utils/scrollSync";

interface CodeEditorProps {
    content: string;
    onChange: (content: string) => void;
    onCursorChange?: (line: number, column: number) => void;
    /** Fires whenever the textarea's selection range changes. `start === end`
     *  indicates a collapsed caret with no selection. Used by the status bar
     *  to show "N words selected" while the user has a range highlighted. */
    onSelectionChange?: (start: number, end: number) => void;
    onImagePaste?: () => void; // Callback when image is successfully pasted
    onError?: (message: string) => void; // Callback for error messages
    filePath?: string | null; // Current file path for saving images
    onScrollFraction?: (fraction: number) => void;
    registerScroller?: (scroller: Scroller | null) => void;
    typewriterMode?: boolean;
    showToolbar?: boolean;
    wordWrap?: boolean;
    spellCheck?: boolean;
    aiConfig?: { endpoint: string; model: string; apiKey: string };
}

// Locked metrics for perfect alignment between textarea and highlight layer.
// Both layers MUST use these exact values to keep the caret on top of the rendered text.
const EDITOR_FONT_FAMILY =
    "'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace";
const EDITOR_FONT_SIZE = 14; // px
const EDITOR_LINE_HEIGHT = 24; // px
const EDITOR_PADDING = 16; // px
const EDITOR_TAB_SIZE = 4;

const sharedTextStyle: React.CSSProperties = {
    fontFamily: EDITOR_FONT_FAMILY,
    fontSize: `${EDITOR_FONT_SIZE}px`,
    lineHeight: `${EDITOR_LINE_HEIGHT}px`,
    padding: `${EDITOR_PADDING}px`,
    tabSize: EDITOR_TAB_SIZE,
    MozTabSize: EDITOR_TAB_SIZE,
    // Lock every metric-affecting property to defend the textarea/overlay
    // alignment guarantee. If a parent rule (theme, body, dialog, etc.) ever
    // sets bold/italic/etc. on an ancestor, both layers must inherit the SAME
    // value or the caret will visually offset from the rendered glyph.
    fontWeight: 400,
    fontStyle: "normal",
    fontVariantLigatures: "none",
    fontVariantNumeric: "normal",
    fontFeatureSettings: "normal",
    fontVariationSettings: "normal",
    fontKerning: "none",
    letterSpacing: "0px",
    whiteSpace: "pre",
    wordBreak: "normal",
    overflowWrap: "normal",
    boxSizing: "border-box",
    // Reserve a fixed-width scrollbar gutter on both layers regardless of
    // whether the scrollbar is currently shown. Without this, the textarea's
    // scrollbar appears once content overflows vertically and silently
    // narrows the content area by ~10px — but the highlight overlay (which
    // has no scrollbar) keeps its full width. The two layers then wrap text
    // at different columns, and after a couple of wrapped lines the caret
    // visibly drifts off the rendered glyph. Reserving the gutter keeps
    // both layers' content widths identical.
    scrollbarGutter: "stable",
};

// Stable per-line wrapper styles. Hoisting these out of the render path means
// every <div> in the highlight overlay receives the SAME style ref across
// renders, so React's prop diff is a single ref check instead of an iteration
// over the keys of a freshly-allocated style object. With 5k+ lines the
// difference is measurable on each keystroke.
const HIGHLIGHT_LINE_STYLE_FIXED: React.CSSProperties = {
    height: `${EDITOR_LINE_HEIGHT}px`,
    lineHeight: `${EDITOR_LINE_HEIGHT}px`,
    position: "relative",
};
const HIGHLIGHT_LINE_STYLE_WRAP: React.CSSProperties = {
    minHeight: `${EDITOR_LINE_HEIGHT}px`,
    lineHeight: `${EDITOR_LINE_HEIGHT}px`,
    position: "relative",
};

// Renders every line — used for small docs and word-wrap mode. Memoized so
// React skips reconciliation entirely when the `lines` ref hasn't changed
// (the per-line cache in CodeEditor preserves array refs for unchanged lines,
// but React still walks children unless the parent itself short-circuits).
const RenderedLines = memo(function RenderedLines({
    lines,
    wordWrap,
}: {
    lines: React.ReactNode[];
    wordWrap: boolean;
}) {
    const lineStyle = wordWrap ? HIGHLIGHT_LINE_STYLE_WRAP : HIGHLIGHT_LINE_STYLE_FIXED;
    return (
        <>
            {lines.map((node, i) => (
                <div key={i} style={lineStyle}>
                    {node}
                </div>
            ))}
        </>
    );
});

// Renders only the slice [firstVisible, lastVisible) of the doc, with
// fixed-height spacers above and below to preserve the textarea/overlay
// scroll-height parity (caret-glyph alignment depends on it). Only valid
// when wordWrap is OFF — variable line heights would break the geometry.
const VirtualizedHighlight = memo(function VirtualizedHighlight({
    lines,
    firstVisible,
    lastVisible,
}: {
    lines: React.ReactNode[];
    firstVisible: number;
    lastVisible: number;
}) {
    const total = lines.length;
    const slice: React.ReactNode[] = [];
    const end = Math.min(lastVisible, total);
    for (let i = firstVisible; i < end; i++) {
        slice.push(
            <div key={i} style={HIGHLIGHT_LINE_STYLE_FIXED}>
                {lines[i]}
            </div>
        );
    }
    const topSpacer = firstVisible * EDITOR_LINE_HEIGHT;
    const bottomSpacer = Math.max(0, total - end) * EDITOR_LINE_HEIGHT;
    return (
        <>
            {topSpacer > 0 && <div aria-hidden style={{ height: `${topSpacer}px` }} />}
            {slice}
            {bottomSpacer > 0 && <div aria-hidden style={{ height: `${bottomSpacer}px` }} />}
        </>
    );
});

// Line-number gutter. Extracted + memoized so typing within a single line
// (lineCount unchanged, activeLine unchanged) doesn't cause React to reconcile
// thousands of <div>s on every keystroke. Only re-renders when the visible line
// count or active line actually changes.
const Gutter = memo(forwardRef<HTMLDivElement, { lineCount: number; activeLine: number }>(
    function Gutter({ lineCount, activeLine }, ref) {
        return (
            <div
                ref={ref}
                className="w-14 shrink-0 bg-[var(--bg-gutter)] border-r border-[var(--border-subtle)] no-select text-xs text-[var(--text-muted)] overflow-hidden transition-colors"
                style={{
                    fontFamily: EDITOR_FONT_FAMILY,
                    fontSize: `${EDITOR_FONT_SIZE}px`,
                    lineHeight: `${EDITOR_LINE_HEIGHT}px`,
                    paddingTop: `${EDITOR_PADDING}px`,
                    paddingBottom: `${EDITOR_PADDING}px`,
                    paddingRight: "12px",
                }}
            >
                <div className="flex flex-col items-end">
                    {Array.from({ length: lineCount }, (_, i) => {
                        const isActive = i + 1 === activeLine;
                        return (
                            <div
                                key={i}
                                className={isActive ? "text-[var(--text-primary)] font-medium" : ""}
                                style={{ height: `${EDITOR_LINE_HEIGHT}px`, lineHeight: `${EDITOR_LINE_HEIGHT}px` }}
                            >
                                {i + 1}
                            </div>
                        );
                    })}
                </div>
            </div>
        );
    }
));

function CodeEditorImpl({ content, onChange, onCursorChange, onSelectionChange, onImagePaste, onError, filePath, onScrollFraction, registerScroller, typewriterMode, showToolbar, wordWrap = true, spellCheck = false, aiConfig }: CodeEditorProps) {
    // When word wrap is on, long lines wrap inside the editor and the highlight
    // overlay; when off, lines scroll horizontally. Both layers must agree on
    // these styles or the caret will visually drift away from the rendered text.
    const wrapStyle: React.CSSProperties = wordWrap
        ? { whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" }
        : { whiteSpace: "pre", wordBreak: "normal", overflowWrap: "normal" };
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);
    const highlightRef = useRef<HTMLDivElement>(null);
    const [activeLine, setActiveLine] = useState(1);
    const [findOpen, setFindOpen] = useState(false);
    const [findMode, setFindMode] = useState<"find" | "replace">("find");
    const [selStartForFind, setSelStartForFind] = useState(0);

    // Slash menu state — tracked as the index of the "/" trigger and the live query
    // (text typed after the slash). Caret movement / blur closes the menu.
    const [slashState, setSlashState] = useState<{ startIdx: number; pos: { x: number; y: number } } | null>(null);
    const [slashQuery, setSlashQuery] = useState("");
    const [aiBubble, setAIBubble] = useState<{ x: number; y: number; selStart: number; selEnd: number; text: string } | null>(null);

    const lines = useMemo(() => content.split("\n"), [content]);
    const lineCount = lines.length;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
    };

    // Apply an EditorResult: update content + restore selection on next frame.
    // (selection must be set after React flushes the new value to the DOM)
    const applyResult = useCallback((r: EditorResult) => {
        onChange(r.text);
        requestAnimationFrame(() => {
            const t = textareaRef.current;
            if (!t) return;
            t.selectionStart = r.selStart;
            t.selectionEnd = r.selEnd;
        });
    }, [onChange]);

    const getState = useCallback(() => {
        const t = textareaRef.current;
        if (!t) return null;
        return { text: t.value, selStart: t.selectionStart, selEnd: t.selectionEnd };
    }, []);

    const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        const state = getState();
        if (!state) return;

        // Ctrl+F / Ctrl+H — open find / find-and-replace bar
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
            if (e.key === "f" || e.key === "F") {
                e.preventDefault();
                setSelStartForFind(state.selStart);
                setFindMode("find");
                setFindOpen(true);
                return;
            }
            if (e.key === "h" || e.key === "H") {
                e.preventDefault();
                setSelStartForFind(state.selStart);
                setFindMode("replace");
                setFindOpen(true);
                return;
            }
        }
        // AI bubble: Ctrl+J on Linux/macOS (WebKitGTK / WKWebView), Alt+J
        // everywhere — including Windows, where WebView2 grabs Ctrl+J for
        // the built-in Downloads UI before the page can preventDefault. The
        // Alt+J alias keeps the J mnemonic without colliding with that
        // accelerator.
        const isAiCombo =
            ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "j" || e.key === "J")) ||
            (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && (e.key === "j" || e.key === "J" || e.code === "KeyJ"));
        if (isAiCombo) {
            e.preventDefault();
            const t = textareaRef.current;
            if (!t) return;
            const lineIdx = t.value.slice(0, state.selStart).split("\n").length - 1;
            const rect = t.getBoundingClientRect();
            const y = rect.top + EDITOR_PADDING + lineIdx * EDITOR_LINE_HEIGHT - t.scrollTop + EDITOR_LINE_HEIGHT + 4;
            const x = rect.left + EDITOR_PADDING + 12;
            const text = state.text.slice(state.selStart, state.selEnd);
            setAIBubble({ x, y, selStart: state.selStart, selEnd: state.selEnd, text });
            return;
        }

        // Ctrl/Cmd shortcuts (Bold, Italic, Link). Other Ctrl combos handled at app level.
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
            if (e.key === "b" || e.key === "B") {
                e.preventDefault();
                applyResult(wrapSelection(state, "**", "**", "bold"));
                return;
            }
            if (e.key === "i" || e.key === "I") {
                e.preventDefault();
                applyResult(wrapSelection(state, "*", "*", "italic"));
                return;
            }
            if (e.key === "k" || e.key === "K") {
                e.preventDefault();
                applyResult(insertLink(state));
                return;
            }
            // Ctrl+/ — toggle blockquote on the current line
            if (e.key === "/") {
                e.preventDefault();
                const ls = state.text.lastIndexOf("\n", state.selStart - 1) + 1;
                const lineEnd = state.text.indexOf("\n", state.selStart);
                const end = lineEnd === -1 ? state.text.length : lineEnd;
                const line = state.text.slice(ls, end);
                const quoted = line.startsWith("> ");
                const newLine = quoted ? line.slice(2) : "> " + line;
                const delta = newLine.length - line.length;
                applyResult({
                    text: state.text.slice(0, ls) + newLine + state.text.slice(end),
                    selStart: state.selStart + delta,
                    selEnd: state.selEnd + delta,
                });
                return;
            }
        }

        if (e.key === "Tab") {
            const r = handleTab(state, e.shiftKey);
            if (r) {
                e.preventDefault();
                applyResult(r);
            }
            return;
        }

        if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const r = handleEnter(state);
            if (r) {
                e.preventDefault();
                applyResult(r);
            }
            return;
        }

        if (e.key === "Backspace" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const r = handleBackspace(state);
            if (r) {
                e.preventDefault();
                applyResult(r);
            }
            return;
        }

        // Auto-pair / skip-closer: only for printable single-char keys
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const skip = handleSkipCloser(state, e.key);
            if (skip) {
                e.preventDefault();
                const t = textareaRef.current;
                if (t) {
                    t.selectionStart = skip.selStart;
                    t.selectionEnd = skip.selEnd;
                }
                return;
            }
            const pair = handleAutoPair(state, e.key);
            if (pair) {
                e.preventDefault();
                applyResult(pair);
                return;
            }
        }
    }, [applyResult, getState]);

    // Handle paste events — order: image → smart paste rules → default text.
    const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const imageFile = getImageFromClipboard(e.nativeEvent);

        if (imageFile) {
            e.preventDefault();

            if (!filePath) {
                onError?.('Please save your file first before pasting images.');
                return;
            }

            try {
                const imagePath = await saveImageToFile(imageFile, filePath);
                const timestamp = Date.now();
                const altText = `image-${timestamp}`;
                const markdownImage = createMarkdownImage(imagePath, altText);

                const textarea = textareaRef.current;
                if (!textarea) return;

                const cursorPos = textarea.selectionStart;
                const { newText, newCursorPosition } = insertAtCursor(content, cursorPos, markdownImage);
                onChange(newText);

                requestAnimationFrame(() => {
                    if (textareaRef.current) {
                        textareaRef.current.selectionStart = newCursorPosition;
                        textareaRef.current.selectionEnd = newCursorPosition;
                        textareaRef.current.focus();
                    }
                });

                onImagePaste?.();
                return;
            } catch (error) {
                console.error('Failed to paste image:', error);
                // Surface the actual error so "Image is 30 MB; maximum is
                // 25 MB" reaches the user rather than a generic retry hint.
                const msg =
                    typeof error === "string"
                        ? error
                        : (error as { message?: string })?.message;
                onError?.(msg || 'Failed to save image. Please try again.');
                return;
            }
        }

        // Smart paste rules — run on text/html and text/plain payloads.
        const t = textareaRef.current;
        if (!t) return;
        const cd = e.clipboardData;
        if (!cd) return;
        const html = cd.getData("text/html");
        const text = cd.getData("text/plain");

        const state = { text: t.value, selStart: t.selectionStart, selEnd: t.selectionEnd };

        // 1) URL on selection → [text](url)
        const urlOnSel = pasteUrlOnSelection(state, text);
        if (urlOnSel) {
            e.preventDefault();
            applyResult(urlOnSel);
            return;
        }
        // 2) Plain URL on empty selection → <url>
        const autolink = pasteUrlAutolink(state, text);
        if (autolink) {
            e.preventDefault();
            applyResult(autolink);
            return;
        }
        // 3) TSV → table (only when no rich HTML present, so spreadsheet plain
        //    paste wins, but a webpage with an HTML table goes through turndown)
        if (!html) {
            const tsv = pasteTsvAsTable(state, text);
            if (tsv) {
                e.preventDefault();
                applyResult(tsv);
                return;
            }
        }
        // 4) Rich HTML → markdown via turndown (skipped if it's just a textual
        //    fragment — heuristic: contains real tags)
        if (html && /<\w+/.test(html)) {
            e.preventDefault();
            try {
                const md = (await htmlToMarkdown(html)).trim();
                if (md) {
                    applyResult({
                        text: state.text.slice(0, state.selStart) + md + state.text.slice(state.selEnd),
                        selStart: state.selStart + md.length,
                        selEnd: state.selStart + md.length,
                    });
                    return;
                }
            } catch {
                // fall through to plain paste
            }
            // turndown failed or returned empty — paste the text/plain instead
            applyResult({
                text: state.text.slice(0, state.selStart) + text + state.text.slice(state.selEnd),
                selStart: state.selStart + text.length,
                selEnd: state.selStart + text.length,
            });
        }
        // else: let default paste handle plain text
    }, [content, onChange, onImagePaste, onError, filePath, applyResult]);

    // Calculate cursor position (line and column) and active line for highlight
    const updateCursorPosition = useCallback(() => {
        if (!textareaRef.current) return;

        const textarea = textareaRef.current;
        const cursorPos = textarea.selectionStart;
        const selEnd = textarea.selectionEnd;
        const textBeforeCursor = textarea.value.substring(0, cursorPos);
        const linesBeforeCursor = textBeforeCursor.split("\n");
        const line = linesBeforeCursor.length;
        const column = linesBeforeCursor[linesBeforeCursor.length - 1].length + 1;

        setActiveLine(line);
        onCursorChange?.(line, column);
        onSelectionChange?.(cursorPos, selEnd);
    }, [onCursorChange, onSelectionChange]);

    // Track cursor on every relevant event (selectionchange catches all caret moves)
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handler = () => {
            // selectionchange fires on document; only react if our textarea is focused
            if (document.activeElement === textarea) {
                updateCursorPosition();
            }
        };

        document.addEventListener("selectionchange", handler);
        textarea.addEventListener("keyup", updateCursorPosition);
        textarea.addEventListener("click", updateCursorPosition);
        textarea.addEventListener("focus", updateCursorPosition);

        updateCursorPosition();

        return () => {
            document.removeEventListener("selectionchange", handler);
            textarea.removeEventListener("keyup", updateCursorPosition);
            textarea.removeEventListener("click", updateCursorPosition);
            textarea.removeEventListener("focus", updateCursorPosition);
        };
    }, [updateCursorPosition]);

    // Indirection ref so the rAF sync below can call the latest
    // recomputeVisible without re-installing the rAF loop on every render.
    // Assigned just below where recomputeVisible is declared.
    const recomputeVisibleRef = useRef<() => void>(() => { });

    // Use rAF-based scroll sync for sub-frame accuracy. The native scroll event
    // can lag the caret by 1 frame; rAF lets us catch up before paint.
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        let rafId: number | null = null;
        let lastTop = -1;
        let lastLeft = -1;

        const sync = () => {
            const t = textareaRef.current;
            if (!t) {
                rafId = null;
                return;
            }
            const top = t.scrollTop;
            const left = t.scrollLeft;
            if (top !== lastTop || left !== lastLeft) {
                if (highlightRef.current) {
                    highlightRef.current.scrollTop = top;
                    highlightRef.current.scrollLeft = left;
                }
                if (gutterRef.current) {
                    gutterRef.current.scrollTop = top;
                }
                if (top !== lastTop) {
                    if (onScrollFraction) {
                        const max = t.scrollHeight - t.clientHeight;
                        onScrollFraction(max > 0 ? top / max : 0);
                    }
                    // Re-evaluate the virtualization window on real vertical
                    // motion. The hysteresis inside guarantees we only call
                    // setState when the window has actually moved.
                    recomputeVisibleRef.current();
                }
                lastTop = top;
                lastLeft = left;
            }
            rafId = requestAnimationFrame(sync);
        };

        rafId = requestAnimationFrame(sync);

        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [onScrollFraction]);

    // Register an imperative scroller so external code (split-view sync) can
    // drive our scroll position by fraction without touching internals.
    useEffect(() => {
        if (!registerScroller) return;
        registerScroller({
            setFraction: (f: number) => {
                const t = textareaRef.current;
                if (!t) return;
                const max = t.scrollHeight - t.clientHeight;
                if (max > 0) t.scrollTop = max * f;
            },
        });
        return () => registerScroller(null);
    }, [registerScroller]);

    // Per-line highlight cache. Most keystrokes only change ONE source line, so
    // re-running `highlightLine` over every line — and minting fresh React
    // elements for the unchanged ones — is wasted work. The cache returns the
    // identical React node for repeat line text; React's reconciler then
    // short-circuits on `prev === next` and skips the unchanged children.
    //
    // Cache is per-component-instance and bounded two ways:
    //   1) HARD CAP via FIFO eviction (Map insertion-order). Without this, a
    //      doc where every line is unique (think 10k lines of UUIDs) would
    //      grow the cache by `lines.length` per render forever.
    //   2) Stale-entry pruning when growth outpaces in-use lines by >256.
    //
    // We do NOT touch entries on hit. The previous version did delete+set per
    // line per render to maintain LRU order — that's ~2N Map mutations per
    // keystroke for a doc with N lines (20 k ops on a 10 k-line file). Their
    // only purpose was to influence overflow eviction order, and overflow
    // only fires on docs with >4 k UNIQUE lines (rare). The "is this line
    // still in the doc?" pruning is the load-bearing bound; FIFO order is
    // fine for the rare hard-cap fallback.
    const HIGHLIGHT_CACHE_MAX = 4096;
    const highlightCacheRef = useRef<Map<string, React.ReactNode>>(new Map());
    const highlightedLines = useMemo(() => {
        const cache = highlightCacheRef.current;
        const out: React.ReactNode[] = new Array(lines.length);
        const inUse = new Set<string>();
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            let node = cache.get(line);
            if (node === undefined) {
                node = highlightLine(line);
                cache.set(line, node);
            }
            out[i] = node;
            inUse.add(line);
        }
        if (cache.size > inUse.size + 256) {
            for (const key of cache.keys()) {
                if (!inUse.has(key)) cache.delete(key);
            }
        }
        // Hard ceiling regardless of in-use set size: protects against
        // pathological docs where every line is unique and `inUse` itself is
        // huge. Evict from the front (FIFO) until under the cap.
        while (cache.size > HIGHLIGHT_CACHE_MAX) {
            const oldest = cache.keys().next().value;
            if (oldest === undefined) break;
            cache.delete(oldest);
        }
        return out;
    }, [lines]);

    // Virtualization for the highlight overlay.
    //
    // Without this, a 10k-line file mounts 10k <div> nodes in the highlight
    // layer; every keystroke makes React's reconciler walk all of them even
    // though the per-line node refs are cached and equal. That walk is what
    // makes typing feel "sticky" on large markdown files.
    //
    // We only render the lines currently visible in the viewport, plus a
    // generous buffer so scrolling never reveals an un-rendered gap before
    // the next recompute fires. The total scroll height is preserved with
    // top/bottom spacer divs so the textarea's and overlay's scroll
    // geometry stay identical (caret-glyph alignment depends on it).
    //
    // Word-wrap mode opts out: line heights vary with content there, so we
    // can't compute slot positions without measurement. The cap on
    // `RENDER_ALL_THRESHOLD` keeps small/medium docs unchanged regardless,
    // because virtualization adds a (tiny) per-scroll cost of its own.
    const VIRTUALIZE_BUFFER = 40;
    const RENDER_ALL_THRESHOLD = 400;
    const shouldVirtualize = !wordWrap && lineCount > RENDER_ALL_THRESHOLD;
    const [visibleRange, setVisibleRange] = useState({ first: 0, last: 0 });
    const visibleRangeRef = useRef(visibleRange);
    visibleRangeRef.current = visibleRange;

    const recomputeVisible = useCallback(() => {
        if (!shouldVirtualize) return;
        const t = textareaRef.current;
        if (!t) return;
        const top = t.scrollTop;
        const height = t.clientHeight;
        const first = Math.max(
            0,
            Math.floor((top - EDITOR_PADDING) / EDITOR_LINE_HEIGHT) - VIRTUALIZE_BUFFER
        );
        const last = Math.min(
            lineCount,
            Math.ceil((top + height - EDITOR_PADDING) / EDITOR_LINE_HEIGHT) + VIRTUALIZE_BUFFER
        );
        const cur = visibleRangeRef.current;
        // Hysteresis: only update when the window has shifted enough that a
        // re-render is genuinely needed. Prevents setState thrash during
        // smooth scrolling.
        const halfBuf = VIRTUALIZE_BUFFER / 2;
        if (Math.abs(first - cur.first) >= halfBuf || Math.abs(last - cur.last) >= halfBuf) {
            setVisibleRange({ first, last });
        }
    }, [shouldVirtualize, lineCount]);

    // Keep the ref pointed at the latest recomputeVisible so the rAF sync
    // (which depends only on onScrollFraction) doesn't tear down + rebuild
    // every time lineCount or shouldVirtualize changes.
    recomputeVisibleRef.current = recomputeVisible;

    // Initialize / reset the visible window when virtualization toggles or the
    // doc is replaced wholesale (file open, big paste). Without this the
    // initial state {first:0, last:0} would render zero lines on first paint.
    useEffect(() => {
        if (!shouldVirtualize) {
            // Make sure the next switch back into virtualization re-seeds.
            if (visibleRangeRef.current.last !== 0) {
                setVisibleRange({ first: 0, last: 0 });
            }
            return;
        }
        const t = textareaRef.current;
        if (!t) return;
        const top = t.scrollTop;
        const height = t.clientHeight || 600;
        const first = Math.max(
            0,
            Math.floor((top - EDITOR_PADDING) / EDITOR_LINE_HEIGHT) - VIRTUALIZE_BUFFER
        );
        const last = Math.min(
            lineCount,
            Math.ceil((top + height - EDITOR_PADDING) / EDITOR_LINE_HEIGHT) + VIRTUALIZE_BUFFER
        );
        setVisibleRange({ first, last });
    }, [shouldVirtualize, lineCount]);

    // Hook recomputeVisible into scroll. We piggyback on the existing rAF in
    // the next effect (it already runs on every frame while there's scroll
    // motion); no extra event listener needed.

    // Typewriter mode: keep the active line vertically centered as the caret moves.
    useEffect(() => {
        if (!typewriterMode) return;
        const t = textareaRef.current;
        if (!t) return;
        const targetTop = (activeLine - 1) * EDITOR_LINE_HEIGHT - t.clientHeight / 2 + EDITOR_LINE_HEIGHT / 2;
        // Smooth via rAF for a calmer scroll than scrollTo({behavior:'smooth'}) which
        // can fight the user's own input on some browsers.
        const start = t.scrollTop;
        const distance = Math.max(0, targetTop) - start;
        if (Math.abs(distance) < 1) return;
        let raf = 0;
        const t0 = performance.now();
        const dur = 120;
        const step = (now: number) => {
            const p = Math.min(1, (now - t0) / dur);
            const eased = 1 - Math.pow(1 - p, 3);
            t.scrollTop = start + distance * eased;
            if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [activeLine, typewriterMode]);

    // Slash-command lifecycle. When user types "/" at line start, open the menu
    // anchored below the caret line. As they keep typing, update the query.
    // Caret moving outside [startIdx, caretPos] or pressing Escape closes it.
    useEffect(() => {
        const t = textareaRef.current;
        if (!t) return;

        const recomputePos = (lineIdx: number) => {
            const rect = t.getBoundingClientRect();
            return {
                x: rect.left + EDITOR_PADDING,
                y: rect.top + EDITOR_PADDING + lineIdx * EDITOR_LINE_HEIGHT - t.scrollTop + EDITOR_LINE_HEIGHT + 4,
            };
        };

        const onKeyUp = () => {
            const pos = t.selectionStart;
            const value = t.value;

            if (slashState) {
                // Close if caret moved left of start, or to a different line
                if (pos < slashState.startIdx + 1) {
                    setSlashState(null);
                    setSlashQuery("");
                    return;
                }
                const between = value.slice(slashState.startIdx + 1, pos);
                if (between.includes("\n") || between.includes(" ")) {
                    setSlashState(null);
                    setSlashQuery("");
                    return;
                }
                setSlashQuery(between);
                return;
            }

            // Maybe open: caret right after a "/" that's at line start or post-whitespace
            if (pos > 0 && value[pos - 1] === "/") {
                const before = value.slice(0, pos - 1);
                const lastNl = before.lastIndexOf("\n");
                const lineHead = value.slice(lastNl + 1, pos - 1);
                // Only at start of line, or after a single space (e.g. nested in lists)
                if (lineHead === "" || /^\s*$/.test(lineHead) || /[\s]$/.test(lineHead)) {
                    const lineIdx = before.split("\n").length - 1;
                    setSlashState({ startIdx: pos - 1, pos: recomputePos(lineIdx) });
                    setSlashQuery("");
                }
            }
        };

        t.addEventListener("keyup", onKeyUp);
        t.addEventListener("click", onKeyUp);
        return () => {
            t.removeEventListener("keyup", onKeyUp);
            t.removeEventListener("click", onKeyUp);
        };
    }, [slashState]);

    const handleSlashSelect = useCallback((cmd: SlashCommand) => {
        if (!slashState) return;
        const t = textareaRef.current;
        if (!t) return;
        const pos = t.selectionStart;
        // Replace the "/query" range with the snippet
        const newText = t.value.slice(0, slashState.startIdx) + cmd.snippet + t.value.slice(pos);
        const caretAt = slashState.startIdx + (cmd.caretOffset ?? cmd.snippet.length);
        applyResult({ text: newText, selStart: caretAt, selEnd: caretAt });
        setSlashState(null);
        setSlashQuery("");
    }, [slashState, applyResult]);

    // Syntax highlighting for markdown
    function highlightLine(line: string): React.ReactNode {
        if (line.startsWith("# ")) {
            return <span className="text-[var(--syntax-h1)] font-bold">{line}</span>;
        }
        if (line.startsWith("## ")) {
            return <span className="text-[var(--syntax-h2)] font-bold">{line}</span>;
        }
        if (line.startsWith("### ") || line.startsWith("#### ")) {
            return <span className="text-[var(--syntax-h3)] font-semibold">{line}</span>;
        }
        if (line.startsWith("```")) {
            return <span className="text-[var(--syntax-code)]">{line}</span>;
        }
        if (line.match(/^[\s]*[-*+]\s/)) {
            const marker = line.match(/^[\s]*[-*+]/)?.[0] || "";
            const rest = line.slice(marker.length);
            return (
                <>
                    <span className="text-[var(--syntax-list)]">{marker}</span>
                    <span>{rest}</span>
                </>
            );
        }
        if (line.match(/^[\s]*\d+\.\s/)) {
            const match = line.match(/^([\s]*\d+\.)/);
            const marker = match?.[0] || "";
            const rest = line.slice(marker.length);
            return (
                <>
                    <span className="text-[var(--syntax-number)]">{marker}</span>
                    <span>{rest}</span>
                </>
            );
        }
        if (line.startsWith(">")) {
            return <span className="text-[var(--syntax-quote)] italic">{line}</span>;
        }
        if (line.includes("![") && line.includes("](")) {
            return highlightImages(line);
        }
        if (line.includes("[") && line.includes("](")) {
            return highlightLinks(line);
        }
        if (line.includes("**")) {
            return highlightBold(line);
        }
        // Empty lines must render something with zero width but real height.
        // Using "" lets the parent line-height (24px) own vertical metrics —
        // identical to how a textarea renders an empty line. NBSP would shift
        // baseline metrics on some fonts and desync the caret.
        return <span>{line}</span>;
    }

    function highlightImages(text: string): React.ReactNode {
        const parts: React.ReactNode[] = [];
        const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
        let lastIndex = 0;
        let match;
        let key = 0;

        while ((match = imageRegex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
            }

            const altText = match[1];
            const url = match[2];
            const displayUrl = url.startsWith('data:')
                ? `data:image/...`
                : url.length > 40
                    ? url.slice(0, 37) + '...'
                    : url;

            parts.push(
                <span key={key++} className="text-[var(--syntax-link)]">
                    <span className="text-[var(--syntax-bold)]">!</span>
                    [{altText}]
                    <span className="text-[var(--syntax-code)] opacity-70">({displayUrl})</span>
                </span>
            );
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
        }

        return parts.length > 0 ? <>{parts}</> : <span>{text}</span>;
    }

    function highlightLinks(text: string): React.ReactNode {
        const parts: React.ReactNode[] = [];
        const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
        let lastIndex = 0;
        let match;
        let key = 0;

        while ((match = linkRegex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
            }
            parts.push(
                <span key={key++} className="text-[var(--syntax-link)]">
                    [{match[1]}]
                    <span className="text-[var(--syntax-code)]">({match[2]})</span>
                </span>
            );
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
        }

        return parts.length > 0 ? <>{parts}</> : <span>{text}</span>;
    }

    function highlightBold(text: string): React.ReactNode {
        const parts: React.ReactNode[] = [];
        const boldRegex = /\*\*([^*]+)\*\*/g;
        let lastIndex = 0;
        let match;
        let key = 0;

        while ((match = boldRegex.exec(text)) !== null) {
            if (match.index > lastIndex) {
                parts.push(<span key={key++}>{text.slice(lastIndex, match.index)}</span>);
            }
            parts.push(
                <span key={key++} className="text-[var(--syntax-bold)] font-bold">
                    {match[0]}
                </span>
            );
            lastIndex = match.index + match[0].length;
        }

        if (lastIndex < text.length) {
            parts.push(<span key={key++}>{text.slice(lastIndex)}</span>);
        }

        return parts.length > 0 ? <>{parts}</> : <span>{text}</span>;
    }

    const handleFindJump = useCallback((start: number, end: number) => {
        const t = textareaRef.current;
        if (!t) return;
        t.focus();
        t.selectionStart = start;
        t.selectionEnd = end;
        // Scroll the matched line into view (textarea native scrollIntoView is unreliable;
        // compute by line index instead)
        const lineIdx = content.slice(0, start).split("\n").length - 1;
        const desiredTop = lineIdx * EDITOR_LINE_HEIGHT - t.clientHeight / 2;
        t.scrollTop = Math.max(0, desiredTop);
    }, [content]);

    const handleFindReplace = useCallback((newContent: string, newCursor: number) => {
        onChange(newContent);
        requestAnimationFrame(() => {
            const t = textareaRef.current;
            if (!t) return;
            t.selectionStart = newCursor;
            t.selectionEnd = newCursor;
        });
    }, [onChange]);

    const insertAtCaret = useCallback((text: string) => {
        const t = textareaRef.current;
        if (!t) return;
        applyResult({
            text: t.value.slice(0, t.selectionStart) + text + t.value.slice(t.selectionEnd),
            selStart: t.selectionStart + text.length,
            selEnd: t.selectionStart + text.length,
        });
    }, [applyResult]);

    return (
        <main className="flex-1 flex flex-col overflow-hidden relative">
            {showToolbar && (
                <FormatToolbar
                    getTextarea={() => textareaRef.current}
                    apply={applyResult}
                    insert={insertAtCaret}
                />
            )}
            <div className="flex flex-1 overflow-hidden relative">
            {/* Line Numbers Gutter — hidden in word-wrap mode because wrapped
                lines occupy multiple visual rows, so per-source-line numbers
                would no longer align with the editor content. The Gutter is
                memoized so typing within a single line doesn't reconcile
                thousands of line-number divs on every keystroke. */}
            {!wordWrap && (
                <Gutter ref={gutterRef} lineCount={lineCount} activeLine={activeLine} />
            )}

            {/* Editor Container */}
            <div className="flex-1 relative bg-[var(--bg-editor)] transition-colors">
                {/* Syntax Highlighted Layer (visual only).
                    Active-line band lives inside this scroll container so it tracks
                    scroll naturally — no JS scrollTop math required.
                    When wordWrap is on, per-line divs use minHeight (so wrapped
                    content can grow) and the active-line band is suppressed,
                    since its fixed Y assumes uniform line heights. */}
                <div
                    ref={highlightRef}
                    // overflow:auto (instead of hidden) so the `scrollbar-gutter:
                    // stable` rule in sharedTextStyle takes effect — that gutter
                    // is what keeps wrap columns identical between this layer
                    // and the textarea. The scrollbar itself stays invisible
                    // (see .editor-overlay-scrollbar-hidden in index.css), and
                    // pointer-events:none means the user never interacts with
                    // it directly anyway. Vertical scroll position is driven
                    // imperatively by the rAF sync below.
                    className="absolute inset-0 text-[var(--text-primary)] pointer-events-none overflow-auto editor-overlay-scrollbar-hidden"
                    aria-hidden="true"
                    style={{ ...sharedTextStyle, ...wrapStyle }}
                >
                    {!wordWrap && (
                        <div
                            className="absolute left-0 right-0 pointer-events-none"
                            style={{
                                top: `${EDITOR_PADDING + (activeLine - 1) * EDITOR_LINE_HEIGHT}px`,
                                height: `${EDITOR_LINE_HEIGHT}px`,
                                background: "var(--bg-hover)",
                                opacity: 0.45,
                            }}
                        />
                    )}
                    {shouldVirtualize ? (
                        <VirtualizedHighlight
                            lines={highlightedLines}
                            firstVisible={visibleRange.first}
                            lastVisible={visibleRange.last}
                        />
                    ) : (
                        <RenderedLines lines={highlightedLines} wordWrap={wordWrap} />
                    )}
                </div>

                <FindReplaceBar
                    isOpen={findOpen}
                    initialMode={findMode}
                    content={content}
                    selectionStart={selStartForFind}
                    onClose={() => {
                        setFindOpen(false);
                        textareaRef.current?.focus();
                    }}
                    onJumpTo={handleFindJump}
                    onReplace={handleFindReplace}
                />

                <SlashMenu
                    isOpen={!!slashState}
                    position={slashState?.pos ?? null}
                    query={slashQuery}
                    onSelect={handleSlashSelect}
                    onClose={() => { setSlashState(null); setSlashQuery(""); }}
                />

                {aiConfig && aiBubble && (
                    <AIBubble
                        anchor={{ x: aiBubble.x, y: aiBubble.y }}
                        selectedText={aiBubble.text}
                        config={aiConfig}
                        onReplace={(out) => {
                            applyResult({
                                text: content.slice(0, aiBubble.selStart) + out + content.slice(aiBubble.selEnd),
                                selStart: aiBubble.selStart + out.length,
                                selEnd: aiBubble.selStart + out.length,
                            });
                            setAIBubble(null);
                        }}
                        onInsert={(out) => {
                            const insertAt = aiBubble.selEnd;
                            applyResult({
                                text: content.slice(0, insertAt) + "\n\n" + out + content.slice(insertAt),
                                selStart: insertAt + 2 + out.length,
                                selEnd: insertAt + 2 + out.length,
                            });
                            setAIBubble(null);
                        }}
                        onClose={() => setAIBubble(null)}
                    />
                )}

                {/* Actual Editable Textarea — transparent text, real caret.
                    Caret color stays opaque so users see *where* they're typing,
                    even though the glyphs themselves are rendered by the overlay. */}
                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={handleChange}
                    onPaste={handlePaste}
                    onKeyDown={onKeyDown}
                    spellCheck={spellCheck}
                    autoComplete="off"
                    autoCorrect={spellCheck ? "on" : "off"}
                    autoCapitalize="off"
                    className="absolute inset-0 w-full h-full bg-transparent text-transparent caret-[var(--accent)] resize-none outline-none overflow-auto border-0"
                    style={{
                        ...sharedTextStyle,
                        ...wrapStyle,
                        caretColor: "var(--accent)",
                    }}
                />
            </div>
            </div>
        </main>
    );
}

// React.memo so renders driven by App-level state (sidebar toggles, palette
// open/close, theme changes, caret moves driven by selectionchange — see
// updateCursorPosition) skip the editor when its real inputs (content,
// modes, file path) are unchanged. The default shallow comparator is right
// for us: every callback prop is useCallback'd in App and every primitive
// prop is stable between caret-only re-renders.
export const CodeEditor = memo(CodeEditorImpl);
