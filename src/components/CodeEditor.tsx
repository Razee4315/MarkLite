import { useRef, useCallback, useEffect } from "react";

interface CodeEditorProps {
    content: string;
    onChange: (content: string) => void;
    onCursorChange?: (line: number, column: number) => void;
}

export function CodeEditor({ content, onChange, onCursorChange }: CodeEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);
    const highlightRef = useRef<HTMLDivElement>(null);

    // Calculate line numbers
    const lines = content.split("\n");
    const lineCount = lines.length;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
    };

    // Calculate cursor position (line and column)
    const updateCursorPosition = useCallback(() => {
        if (!textareaRef.current || !onCursorChange) return;

        const textarea = textareaRef.current;
        const cursorPos = textarea.selectionStart;
        const textBeforeCursor = textarea.value.substring(0, cursorPos);
        const linesBeforeCursor = textBeforeCursor.split("\n");
        const line = linesBeforeCursor.length;
        const column = linesBeforeCursor[linesBeforeCursor.length - 1].length + 1;

        onCursorChange(line, column);
    }, [onCursorChange]);

    // Track cursor position on various events
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleSelectionChange = () => updateCursorPosition();

        textarea.addEventListener("keyup", handleSelectionChange);
        textarea.addEventListener("click", handleSelectionChange);
        textarea.addEventListener("select", handleSelectionChange);

        // Initial position
        updateCursorPosition();

        return () => {
            textarea.removeEventListener("keyup", handleSelectionChange);
            textarea.removeEventListener("click", handleSelectionChange);
            textarea.removeEventListener("select", handleSelectionChange);
        };
    }, [updateCursorPosition, content]);

    // Sync scroll between textarea, gutter, and highlight layer
    const handleScroll = useCallback(() => {
        if (!textareaRef.current) return;
        const scrollTop = textareaRef.current.scrollTop;
        const scrollLeft = textareaRef.current.scrollLeft;

        if (gutterRef.current) {
            gutterRef.current.scrollTop = scrollTop;
        }
        if (highlightRef.current) {
            highlightRef.current.scrollTop = scrollTop;
            highlightRef.current.scrollLeft = scrollLeft;
        }
    }, []);

    // Syntax highlighting for markdown
    const highlightLine = (line: string): React.ReactNode => {
        // H1 headers
        if (line.startsWith("# ")) {
            return <span className="text-[var(--syntax-h1)] font-bold">{line}</span>;
        }
        // H2 headers
        if (line.startsWith("## ")) {
            return <span className="text-[var(--syntax-h2)] font-bold">{line}</span>;
        }
        // H3+ headers
        if (line.startsWith("### ") || line.startsWith("#### ")) {
            return <span className="text-[var(--syntax-h3)] font-semibold">{line}</span>;
        }
        // Code fence
        if (line.startsWith("```")) {
            return <span className="text-[var(--syntax-code)]">{line}</span>;
        }
        // List items
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
        // Numbered lists
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
        // Blockquote
        if (line.startsWith(">")) {
            return <span className="text-[var(--syntax-quote)] italic">{line}</span>;
        }
        // Links [text](url)
        if (line.includes("[") && line.includes("](")) {
            return highlightLinks(line);
        }
        // Bold **text**
        if (line.includes("**")) {
            return highlightBold(line);
        }
        // Regular text
        return <span>{line || "\u00A0"}</span>;
    };

    const highlightLinks = (text: string): React.ReactNode => {
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
    };

    const highlightBold = (text: string): React.ReactNode => {
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
    };

    return (
        <main className="flex-1 flex overflow-hidden relative">
            {/* Line Numbers Gutter */}
            <div
                ref={gutterRef}
                className="w-14 shrink-0 bg-[var(--bg-gutter)] border-r border-[var(--border-subtle)] py-4 pr-3 no-select text-xs font-mono text-[var(--text-muted)] overflow-hidden transition-colors"
            >
                <div className="flex flex-col items-end">
                    {Array.from({ length: lineCount }, (_, i) => (
                        <div key={i} className="leading-6 h-6">
                            {i + 1}
                        </div>
                    ))}
                </div>
            </div>

            {/* Editor Container */}
            <div className="flex-1 relative bg-[var(--bg-editor)] transition-colors">
                {/* Syntax Highlighted Layer (visual only) */}
                <div
                    ref={highlightRef}
                    className="absolute inset-0 p-4 font-mono text-sm leading-6 text-[var(--text-primary)] pointer-events-none overflow-hidden whitespace-pre"
                    aria-hidden="true"
                >
                    {lines.map((line, i) => (
                        <div key={i} className="h-6">
                            {highlightLine(line)}
                        </div>
                    ))}
                </div>

                {/* Actual Editable Textarea */}
                <textarea
                    ref={textareaRef}
                    value={content}
                    onChange={handleChange}
                    onScroll={handleScroll}
                    spellCheck={false}
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    className="absolute inset-0 w-full h-full p-4 font-mono text-sm leading-6 bg-transparent text-transparent caret-[var(--accent)] resize-none outline-none overflow-auto"
                    style={{
                        caretColor: "var(--accent)",
                        whiteSpace: "pre",
                        wordWrap: "normal",
                    }}
                />
            </div>
        </main>
    );
}
