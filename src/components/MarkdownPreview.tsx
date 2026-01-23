import { useRef, useEffect, useCallback, useMemo, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { readFile } from "@tauri-apps/plugin-fs";

interface MarkdownPreviewProps {
    content: string;
    fileName: string;
    lineCount: number;
    fileSize: number;
    onEditClick: () => void;
    onLineChange?: (line: number) => void;
    filePath?: string | null;
}

// Component to handle local image loading
function LocalImage({ src, alt, baseDir, ...props }: { src: string; alt: string; baseDir: string | null } & React.ImgHTMLAttributes<HTMLImageElement>) {
    const [imageSrc, setImageSrc] = useState<string>('');
    const [error, setError] = useState(false);

    useEffect(() => {
        const loadImage = async () => {
            if (!baseDir || !src) return;
            
            // Check if it's a relative path
            if (src.startsWith('./') || src.startsWith('../') || (!src.includes('://') && !src.startsWith('data:'))) {
                try {
                    // Remove leading ./ if present
                    const cleanPath = src.startsWith('./') ? src.slice(2) : src;
                    // Construct full path with proper Windows separators
                    const fullPath = `${baseDir}\\${cleanPath.replace(/\//g, '\\')}`;
                    
                    // Read the file as binary
                    const data = await readFile(fullPath);
                    
                    // Detect image type from extension
                    const ext = cleanPath.split('.').pop()?.toLowerCase() || 'png';
                    const mimeTypes: Record<string, string> = {
                        'png': 'image/png',
                        'jpg': 'image/jpeg',
                        'jpeg': 'image/jpeg',
                        'gif': 'image/gif',
                        'webp': 'image/webp',
                        'svg': 'image/svg+xml',
                        'bmp': 'image/bmp'
                    };
                    const mimeType = mimeTypes[ext] || 'image/png';
                    
                    // Convert to base64 data URL
                    const base64 = btoa(String.fromCharCode(...data));
                    setImageSrc(`data:${mimeType};base64,${base64}`);
                    setError(false);
                } catch (err) {
                    console.error('Failed to load image:', err);
                    setError(true);
                }
            } else {
                // External URL or data URL - use as is
                setImageSrc(src);
            }
        };

        loadImage();
    }, [src, baseDir]);

    if (error) {
        return (
            <div className="my-4 p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-secondary)] text-[var(--text-secondary)] text-sm">
                Failed to load image: {src}
            </div>
        );
    }

    if (!imageSrc) {
        return (
            <div className="my-4 p-4 border border-[var(--border-subtle)] rounded-lg bg-[var(--bg-secondary)] animate-pulse">
                <div className="h-32 bg-[var(--bg-tertiary)] rounded"></div>
            </div>
        );
    }

    return (
        <img 
            src={imageSrc} 
            alt={alt || 'image'} 
            {...props}
            className="max-w-full h-auto rounded-lg my-4"
        />
    );
}

export function MarkdownPreview({
    content,
    lineCount,
    onLineChange,
    filePath,
}: MarkdownPreviewProps) {
    const mainRef = useRef<HTMLElement>(null);

    // Get the directory containing the markdown file
    const baseDir = useMemo(() => {
        if (!filePath) return null;
        // Handle both Windows and Unix paths
        const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        return lastSep > 0 ? filePath.slice(0, lastSep) : null;
    }, [filePath]);

    // Custom image component to handle relative paths
    const components = useMemo(() => ({
        img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => {
            return <LocalImage src={src || ''} alt={alt || 'image'} baseDir={baseDir} {...props} />;
        }
    }), [baseDir]);

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
                    <Markdown 
                        remarkPlugins={[remarkGfm]} 
                        rehypePlugins={[rehypeHighlight]}
                        components={components}
                    >
                        {content}
                    </Markdown>
                </div>
            </div>
        </main>
    );
}
