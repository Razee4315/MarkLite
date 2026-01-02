import { useRef, useEffect, useCallback } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownPreviewProps {
    content: string;
    fileName: string;
    lineCount: number;
    fileSize: number;
    onEditClick: () => void;
    onLineChange?: (line: number) => void;
}

export function MarkdownPreview({
    content,
    lineCount,
    onLineChange,
}: MarkdownPreviewProps) {
    const mainRef = useRef<HTMLElement>(null);

    // Calculate current line based on scroll position
    const handleScroll = useCallback(() => {
        if (!mainRef.current || !onLineChange) return;

        const element = mainRef.current;
        const scrollTop = element.scrollTop;
        const scrollHeight = element.scrollHeight - element.clientHeight;

        if (scrollHeight <= 0) {
            onLineChange(1);
            return;
        }

        // Calculate approximate line based on scroll percentage
        const scrollPercentage = scrollTop / scrollHeight;
        const currentLine = Math.max(1, Math.ceil(scrollPercentage * lineCount));

        onLineChange(currentLine);
    }, [lineCount, onLineChange]);

    // Set up scroll listener
    useEffect(() => {
        const element = mainRef.current;
        if (!element) return;

        element.addEventListener("scroll", handleScroll);
        // Initial line
        handleScroll();

        return () => {
            element.removeEventListener("scroll", handleScroll);
        };
    }, [handleScroll]);

    return (
        <main
            ref={mainRef}
            className="flex-1 overflow-y-auto bg-[var(--bg-primary)] transition-colors"
        >
            <div className="max-w-[800px] mx-auto px-8 py-12">
                <div className="markdown-body">
                    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                        {content}
                    </Markdown>
                </div>
            </div>
        </main>
    );
}
