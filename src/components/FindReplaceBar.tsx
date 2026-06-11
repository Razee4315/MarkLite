import { useEffect, useRef, useState, useCallback } from "react";

interface FindReplaceBarProps {
    isOpen: boolean;
    initialMode?: "find" | "replace";
    content: string;
    selectionStart: number;
    onClose: () => void;
    onReplace: (newContent: string, newCursor: number) => void;
    onJumpTo: (start: number, end: number) => void;
}

interface MatchResult {
    matches: number[];
    activeIdx: number;
}

const findAll = (haystack: string, needle: string, caseSensitive: boolean, regex: boolean): number[] => {
    if (!needle) return [];
    const result: number[] = [];
    if (regex) {
        try {
            const re = new RegExp(needle, caseSensitive ? "g" : "gi");
            let m;
            while ((m = re.exec(haystack)) !== null) {
                result.push(m.index);
                if (m.index === re.lastIndex) re.lastIndex++; // avoid zero-width loops
            }
        } catch {
            return [];
        }
        return result;
    }
    const h = caseSensitive ? haystack : haystack.toLowerCase();
    const n = caseSensitive ? needle : needle.toLowerCase();
    let i = h.indexOf(n);
    while (i !== -1) {
        result.push(i);
        i = h.indexOf(n, i + Math.max(1, n.length));
    }
    return result;
};

const matchLength = (haystack: string, idx: number, needle: string, caseSensitive: boolean, regex: boolean): number => {
    if (regex) {
        try {
            const re = new RegExp(needle, caseSensitive ? "g" : "gi");
            re.lastIndex = idx;
            const m = re.exec(haystack);
            return m && m.index === idx ? m[0].length : 0;
        } catch {
            return 0;
        }
    }
    return needle.length;
};

/** Expand $1…$9, $& (whole match) and $$ (literal $) in a regex replacement,
 *  mirroring String.prototype.replace semantics. Without this, "$1" used to be
 *  inserted literally — breaking the main reason to turn regex mode on. */
const expandReplacement = (m: RegExpExecArray, template: string): string =>
    template.replace(/\$(\$|&|[1-9])/g, (whole, g: string) => {
        if (g === "$") return "$";
        if (g === "&") return m[0];
        const idx = Number(g);
        return idx < m.length ? (m[idx] ?? "") : whole;
    });

export function FindReplaceBar({
    isOpen,
    initialMode = "find",
    content,
    selectionStart,
    onClose,
    onReplace,
    onJumpTo,
}: FindReplaceBarProps) {
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [showReplace, setShowReplace] = useState(initialMode === "replace");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [regex, setRegex] = useState(false);
    const [match, setMatch] = useState<MatchResult>({ matches: [], activeIdx: -1 });
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            inputRef.current?.focus();
            inputRef.current?.select();
            setShowReplace(initialMode === "replace");
        }
    }, [isOpen, initialMode]);

    // Recompute matches when query or content changes. Bail out by returning
    // `prev` when nothing changed — without this, every editor keystroke causes
    // setMatch to mint a fresh `{ matches: [], activeIdx: -1 }` for an empty
    // query, which re-renders this dialog (and re-fires the auto-jump effect
    // below) on every character typed in the editor.
    useEffect(() => {
        // Debounce a touch: recomputing on every keystroke is fine for plain
        // text but a pathological regex (e.g. catastrophic backtracking) over a
        // large document shouldn't run once per typed character.
        const id = window.setTimeout(() => {
        const m = findAll(content, query, caseSensitive, regex);
        setMatch((prev) => {
            let active = -1;
            if (m.length > 0) {
                active = m.findIndex((pos) => pos >= selectionStart);
                if (active === -1) active = 0;
                if (prev.activeIdx >= 0 && prev.activeIdx < m.length && prev.matches[prev.activeIdx] === m[prev.activeIdx]) {
                    active = prev.activeIdx;
                }
            }
            // Same activeIdx + same-length + same-positions ⇒ nothing changed.
            if (
                prev.activeIdx === active &&
                prev.matches.length === m.length &&
                prev.matches.every((pos, i) => pos === m[i])
            ) {
                return prev;
            }
            return { matches: m, activeIdx: active };
        });
        }, 100);
        return () => window.clearTimeout(id);
    }, [content, query, caseSensitive, regex, selectionStart]);

    // Auto-jump to active match
    useEffect(() => {
        if (match.activeIdx === -1) return;
        const start = match.matches[match.activeIdx];
        const len = matchLength(content, start, query, caseSensitive, regex);
        if (len > 0) onJumpTo(start, start + len);
        // We intentionally don't depend on onJumpTo to avoid loops
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [match.activeIdx, match.matches]);

    const next = useCallback(() => {
        setMatch((prev) => {
            if (prev.matches.length === 0) return prev;
            return { ...prev, activeIdx: (prev.activeIdx + 1) % prev.matches.length };
        });
    }, []);

    const prev = useCallback(() => {
        setMatch((prevState) => {
            if (prevState.matches.length === 0) return prevState;
            const next = prevState.activeIdx <= 0 ? prevState.matches.length - 1 : prevState.activeIdx - 1;
            return { ...prevState, activeIdx: next };
        });
    }, []);

    const replaceCurrent = useCallback(() => {
        if (match.activeIdx === -1) return;
        const start = match.matches[match.activeIdx];
        let len: number;
        let actualReplacement = replacement;
        if (regex) {
            try {
                const re = new RegExp(query, caseSensitive ? "g" : "gi");
                re.lastIndex = start;
                const m = re.exec(content);
                if (!m || m.index !== start) return;
                len = m[0].length;
                actualReplacement = expandReplacement(m, replacement);
            } catch {
                return;
            }
        } else {
            len = query.length;
        }
        if (len === 0) return;
        const newContent = content.slice(0, start) + actualReplacement + content.slice(start + len);
        onReplace(newContent, start + actualReplacement.length);
    }, [match, content, query, replacement, caseSensitive, regex, onReplace]);

    const replaceAll = useCallback(() => {
        if (match.matches.length === 0) return;
        let updated: string;
        if (regex) {
            // Native String.replace handles $1/$&/$$ expansion and zero-width
            // matches correctly in one pass.
            try {
                updated = content.replace(new RegExp(query, caseSensitive ? "g" : "gi"), replacement);
            } catch {
                return;
            }
        } else {
            // Walk in reverse so indices stay valid as we splice
            updated = content;
            for (let i = match.matches.length - 1; i >= 0; i--) {
                const start = match.matches[i];
                updated = updated.slice(0, start) + replacement + updated.slice(start + query.length);
            }
        }
        // Keep the caret near the first replacement instead of yanking the
        // viewport to the end of the document.
        onReplace(updated, Math.min(match.matches[0] + replacement.length, updated.length));
    }, [match, content, query, replacement, caseSensitive, regex, onReplace]);

    const handleKey = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            onClose();
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) prev();
            else next();
        }
    };

    if (!isOpen) return null;

    const totalLabel = match.matches.length === 0
        ? "No results"
        : `${match.activeIdx + 1} of ${match.matches.length}`;

    return (
        <div
            role="dialog"
            aria-label="Find and replace"
            className="absolute top-2 right-4 z-40 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl px-2 py-2 flex flex-col gap-2 animate-fade-in-down"
            style={{ minWidth: 360 }}
            onKeyDown={handleKey}
        >
            <div className="flex items-center gap-2">
                <button
                    type="button"
                    onClick={() => setShowReplace((v) => !v)}
                    aria-label={showReplace ? "Hide replace" : "Show replace"}
                    className="flex items-center justify-center w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                >
                    <span className="material-symbols-outlined text-[16px]">
                        {showReplace ? "expand_less" : "expand_more"}
                    </span>
                </button>
                <input
                    ref={inputRef}
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find"
                    className="flex-1 px-2 py-1 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                    aria-label="Find text"
                />
                <span className="text-[11px] text-[var(--text-secondary)] tabular-nums whitespace-nowrap min-w-[80px] text-right">
                    {totalLabel}
                </span>
                <button onClick={prev} title="Previous (Shift+Enter)" aria-label="Previous match" className="w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[16px]">keyboard_arrow_up</span>
                </button>
                <button onClick={next} title="Next (Enter)" aria-label="Next match" className="w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[16px]">keyboard_arrow_down</span>
                </button>
                <button
                    onClick={() => setCaseSensitive((v) => !v)}
                    aria-pressed={caseSensitive}
                    title="Match case"
                    className={`w-6 h-6 rounded text-[12px] font-bold flex items-center justify-center ${caseSensitive ? "bg-[var(--accent)] text-[var(--accent-text)]" : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"}`}
                >
                    Aa
                </button>
                <button
                    onClick={() => setRegex((v) => !v)}
                    aria-pressed={regex}
                    title="Regex"
                    className={`w-6 h-6 rounded text-[12px] font-mono flex items-center justify-center ${regex ? "bg-[var(--accent)] text-[var(--accent-text)]" : "hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"}`}
                >
                    .*
                </button>
                <button onClick={onClose} title="Close (Esc)" aria-label="Close find" className="w-6 h-6 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] flex items-center justify-center">
                    <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
            </div>

            {showReplace && (
                <div className="flex items-center gap-2 pl-8">
                    <input
                        type="text"
                        value={replacement}
                        onChange={(e) => setReplacement(e.target.value)}
                        placeholder="Replace"
                        className="flex-1 px-2 py-1 text-sm bg-[var(--bg-input)] border border-[var(--border)] rounded text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
                        aria-label="Replace with"
                    />
                    <button
                        onClick={replaceCurrent}
                        disabled={match.activeIdx === -1}
                        className="px-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Replace
                    </button>
                    <button
                        onClick={replaceAll}
                        disabled={match.matches.length === 0}
                        className="px-2 py-1 text-xs rounded bg-[var(--bg-input)] border border-[var(--border)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                        Replace All
                    </button>
                </div>
            )}
        </div>
    );
}
