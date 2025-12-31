import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface MarkdownPreviewProps {
    content: string;
    fileName: string;
    lineCount: number;
    fileSize: number;
    onEditClick: () => void;
}

export function MarkdownPreview({
    content,
}: MarkdownPreviewProps) {
    return (
        <main className="flex-1 overflow-y-auto bg-[var(--bg-primary)] transition-colors">
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
