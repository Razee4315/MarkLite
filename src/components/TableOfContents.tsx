import { useMemo, useEffect, useRef } from "react";

interface TocItem {
    id: string;
    text: string;
    level: number;
}

interface TableOfContentsProps {
    isOpen: boolean;
    content: string;
    onClose: () => void;
}

export function TableOfContents({
    isOpen,
    content,
    onClose,
}: TableOfContentsProps) {
    const panelRef = useRef<HTMLElement>(null);

    // Parse headings from markdown content
    const headings = useMemo((): TocItem[] => {
        if (!content) return [];

        // Normalize line endings (handle Windows \r\n)
        const normalizedContent = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const lines = normalizedContent.split("\n");
        const items: TocItem[] = [];

        lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            const match = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
            if (match) {
                const level = match[1].length;
                const text = match[2].trim();
                const id = `heading-${index}-${text
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, "")}`;

                items.push({ id, text, level });
            }
        });

        return items;
    }, [content]);

    // Escape key to close and focus management
    useEffect(() => {
        if (!isOpen) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        panelRef.current?.focus();

        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [isOpen, onClose]);

    const handleHeadingClick = (text: string, level: number) => {
        const scrollContainer = document.querySelector("main.overflow-y-auto");
        const previewContainer = document.querySelector(".markdown-body");

        if (previewContainer && scrollContainer) {
            const headingTag = `h${level}`;
            const headingElements = previewContainer.querySelectorAll(headingTag);

            // Clean text for comparison (remove markdown formatting)
            const cleanText = text
                .replace(/\*\*(.+?)\*\*/g, "$1")
                .replace(/\*(.+?)\*/g, "$1")
                .replace(/_(.+?)_/g, "$1")
                .replace(/`(.+?)`/g, "$1")
                .replace(/\[(.+?)\]\(.+?\)/g, "$1")
                .trim();

            for (const el of headingElements) {
                const elText = el.textContent?.trim() || "";
                if (elText === text || elText === cleanText || elText.includes(cleanText)) {
                    const elementTop = el.getBoundingClientRect().top;
                    const containerTop = scrollContainer.getBoundingClientRect().top;
                    const offset = elementTop - containerTop + scrollContainer.scrollTop - 20;

                    scrollContainer.scrollTo({
                        top: offset,
                        behavior: "smooth"
                    });
                    break;
                }
            }
        }
    };

    const getIndent = (level: number): string => {
        const indents = ["", "pl-4", "pl-8", "pl-12", "pl-16", "pl-20"];
        return indents[level - 1] || "";
    };

    const getIcon = (level: number): string => {
        if (level === 1) return "title";
        if (level === 2) return "format_h2";
        return "format_h3";
    };

    return (
        <aside
            ref={panelRef}
            role="navigation"
            aria-label="Table of contents"
            tabIndex={-1}
            className={`fixed left-0 top-12 bottom-7 w-72 bg-[var(--bg-secondary)] border-r border-[var(--border)] z-50 shadow-2xl transition-transform duration-200 ease-out ${isOpen ? "translate-x-0" : "-translate-x-full"
                }`}
        >
            {/* Header */}
            <div className="h-10 px-4 flex items-center justify-between border-b border-[var(--border)] bg-[var(--bg-titlebar)]">
                <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] no-select">
                    <span className="material-symbols-outlined text-[18px]">
                        format_list_bulleted
                    </span>
                    <span>Table of Contents</span>
                </div>
                <button
                    onClick={onClose}
                    aria-label="Close table of contents"
                    className="btn-press flex items-center justify-center w-7 h-7 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                    <span className="material-symbols-outlined text-[18px]">
                        close
                    </span>
                </button>
            </div>

            {/* Content */}
            <nav className="flex-1 overflow-y-auto h-[calc(100%-2.5rem)]" aria-label="Document headings">
                {headings.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-32 text-[var(--text-secondary)] text-sm gap-2">
                        <span className="material-symbols-outlined text-[32px] opacity-40">
                            format_list_bulleted
                        </span>
                        <span>No headings found</span>
                    </div>
                ) : (
                    <ul className="py-2">
                        {headings.map((heading, index) => (
                            <li key={`${heading.id}-${index}`} className="stagger-item" style={{ animationDelay: `${index * 0.03}s` }}>
                                <button
                                    onClick={() =>
                                        handleHeadingClick(heading.text, heading.level)
                                    }
                                    aria-label={`Go to heading: ${heading.text}`}
                                    className={`btn-press w-full px-4 py-2 text-left text-sm flex items-center gap-2 transition-colors text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] ${getIndent(
                                        heading.level
                                    )}`}
                                >
                                    <span
                                        className={`material-symbols-outlined text-[14px] ${heading.level === 1
                                            ? "text-[var(--text-primary)]"
                                            : "opacity-60"
                                            }`}
                                    >
                                        {getIcon(heading.level)}
                                    </span>
                                    <span
                                        className={`truncate ${heading.level === 1
                                            ? "font-semibold text-[var(--text-primary)]"
                                            : heading.level === 2
                                                ? "font-medium"
                                                : ""
                                            }`}
                                    >
                                        {heading.text}
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </nav>
        </aside>
    );
}
