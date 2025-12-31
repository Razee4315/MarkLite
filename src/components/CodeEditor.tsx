import { useRef, useCallback } from "react";

interface CodeEditorProps {
    content: string;
    onChange: (content: string) => void;
}

export function CodeEditor({ content, onChange }: CodeEditorProps) {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const gutterRef = useRef<HTMLDivElement>(null);
    const highlightRef = useRef<HTMLDivElement>(null);

    // Calculate line numbers
    const lines = content.split("\n");
    const lineCount = lines.length;

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value);
    };

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
            return <span className="text-[#bd93f9] font-bold">{line}</span>;
        }
        // H2 headers
        if (line.startsWith("## ")) {
            return <span className="text-[#ff79c6] font-bold">{line}</span>;
        }
        // H3+ headers
        if (line.startsWith("### ") || line.startsWith("#### ")) {
            return <span className="text-[#8be9fd] font-semibold">{line}</span>;
        }
        // Code fence
        if (line.startsWith("```")) {
            return <span className="text-[#6272a4]">{line}</span>;
        }
        // List items
        if (line.match(/^[\s]*[-*+]\s/)) {
            const marker = line.match(/^[\s]*[-*+]/)?.[0] || "";
            const rest = line.slice(marker.length);
            return (
                <>
                    <span className="text-[#ff79c6]">{marker}</span>
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
                    <span className="text-[#ffb86c]">{marker}</span>
                    <span>{rest}</span>
                </>
            );
        }
        // Blockquote
        if (line.startsWith(">")) {
            return <span className="text-[#6272a4] italic">{line}</span>;
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
                <span key={key++} className="text-[#8be9fd]">
                    [{match[1]}]
                    <span className="text-[#6272a4]">({match[2]})</span>
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
                <span key={key++} className="text-[#ffb86c] font-bold">
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
                className="w-14 shrink-0 bg-[#111a22] border-r border-[#233648] py-4 pr-3 no-select text-xs font-mono text-[#465a6e] overflow-hidden"
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
            <div className="flex-1 relative bg-[#0d141c]">
                {/* Syntax Highlighted Layer (visual only) */}
                <div
                    ref={highlightRef}
                    className="absolute inset-0 p-4 font-mono text-sm leading-6 text-[#c9d1d9] pointer-events-none overflow-hidden whitespace-pre"
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
                    className="absolute inset-0 w-full h-full p-4 font-mono text-sm leading-6 bg-transparent text-transparent caret-[#bd93f9] resize-none outline-none overflow-auto"
                    style={{
                        caretColor: "#bd93f9",
                        whiteSpace: "pre",
                        wordWrap: "normal",
                    }}
                />
            </div>
        </main>
    );
}
