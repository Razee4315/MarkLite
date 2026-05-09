import { useRef, useEffect, useCallback, useMemo, useState, memo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { readFile } from "@tauri-apps/plugin-fs";
import { openUrl } from "@tauri-apps/plugin-opener";
import { parseFrontmatter, serializeFrontmatter, type FrontmatterValue } from "../utils/frontmatter";
import type { Scroller } from "../utils/scrollSync";
import { MermaidBlock, isMermaidLanguage } from "./MermaidBlock";

// Detect KaTeX-style math so we only load the heavy katex bundle when needed.
// $$...$$ for block math, $...$ for inline math (not preceded/followed by digit
// to avoid false positives like "$5 and $10"). Also matches chemistry blocks
// written as \ce{...} / \pu{...} so people can use mhchem without explicit $$.
const MATH_DETECTION_REGEX = /(\$\$[\s\S]+?\$\$)|((?:^|[^\d$])\$[^\s$][^\n$]*?[^\s$]\$(?!\d))|(\\ce\{)|(\\pu\{)/m;
const hasMath = (s: string): boolean => MATH_DETECTION_REGEX.test(s);

type PluginPair = { remark: unknown; rehype: unknown };
let mathPluginsCache: PluginPair | null = null;
let mathLoadPromise: Promise<PluginPair> | null = null;

const loadMathPlugins = (): Promise<PluginPair> => {
    if (mathPluginsCache) return Promise.resolve(mathPluginsCache);
    if (mathLoadPromise) return mathLoadPromise;
    // Load mhchem alongside KaTeX so chemistry notation like
    //   $\ce{2 Fe^x_{Fe} + O^x_{O} -> 2 Fe'_{Fe} + V_{O}^{**} + 1/2 O2 ^}$
    // renders properly in standard book-style typography. mhchem patches
    // KaTeX's macro table on import, so it must load before the first render.
    mathLoadPromise = Promise.all([
        import("remark-math"),
        import("rehype-katex"),
        import("katex/dist/katex.min.css"),
        import("katex/dist/contrib/mhchem.mjs"),
    ]).then(([rm, rk]) => {
        mathPluginsCache = { remark: rm.default, rehype: rk.default };
        return mathPluginsCache;
    });
    return mathLoadPromise;
};

interface MarkdownPreviewProps {
    content: string;
    fileName: string;
    fileSize: number;
    onEditClick: () => void;
    onLineChange?: (line: number) => void;
    filePath?: string | null;
    markdownBodyRef?: React.RefObject<HTMLDivElement | null>;
    onContentChange?: (newContent: string) => void;
    onScrollFraction?: (fraction: number) => void;
    registerScroller?: (scroller: Scroller | null) => void;
    onWikilinkClick?: (target: string) => void;
}

/** Slugify heading text into a stable, URL-safe id (GitHub-style). */
const slugify = (text: string): string =>
    text
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "");

/** Extract the plain-text label from a React node tree (for slug + anchor link). */
function nodeText(node: React.ReactNode): string {
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(nodeText).join("");
    if (node && typeof node === "object" && "props" in node) {
        // @ts-expect-error - children may exist on element
        return nodeText(node.props?.children);
    }
    return "";
}

// MIME type lookup for image extensions
const IMAGE_MIME_TYPES: Record<string, string> = {
    'png': 'image/png',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'gif': 'image/gif',
    'webp': 'image/webp',
    'svg': 'image/svg+xml',
    'bmp': 'image/bmp'
};

// Module-level shared cache for local image blobs. Without this, a doc that
// references the same image 50 times reads the file 50 times and creates 50
// independent ObjectURLs. With it, repeat references hit memory.
//
// LRU eviction at CACHE_CAP entries: the Map preserves insertion order, so we
// re-insert on hit (move to end) and evict from the front when full. Evicted
// URLs are revoked so the image data can be GC'd.
const LOCAL_IMAGE_CACHE = new Map<string, string>();
const LOCAL_IMAGE_CACHE_CAP = 100;

async function getCachedLocalImageUrl(fullPath: string, mimeType: string): Promise<string> {
    const hit = LOCAL_IMAGE_CACHE.get(fullPath);
    if (hit !== undefined) {
        // Move-to-end so this entry is now most-recently-used.
        LOCAL_IMAGE_CACHE.delete(fullPath);
        LOCAL_IMAGE_CACHE.set(fullPath, hit);
        return hit;
    }
    const data = await readFile(fullPath);
    const blob = new Blob([new Uint8Array(data)], { type: mimeType });
    const url = URL.createObjectURL(blob);
    LOCAL_IMAGE_CACHE.set(fullPath, url);
    if (LOCAL_IMAGE_CACHE.size > LOCAL_IMAGE_CACHE_CAP) {
        const oldestKey = LOCAL_IMAGE_CACHE.keys().next().value;
        if (oldestKey !== undefined) {
            const oldUrl = LOCAL_IMAGE_CACHE.get(oldestKey);
            if (oldUrl) URL.revokeObjectURL(oldUrl);
            LOCAL_IMAGE_CACHE.delete(oldestKey);
        }
    }
    return url;
}

/**
 * Reject paths that would escape the markdown file's directory or name an
 * absolute location. The capabilities allow `**` reads, so we have to enforce
 * the boundary in code: a malicious .md must not be able to use
 * `![pwn](../../../etc/passwd)` to peek at arbitrary files.
 */
function isUnsafeRelativePath(p: string): boolean {
    if (!p) return true;
    if (/\0/.test(p)) return true;
    // Absolute paths: leading slash, leading backslash, or drive letter.
    if (/^([a-zA-Z]:|\/|\\)/.test(p)) return true;
    // Any segment that is exactly `..` (handles foo/../etc, ../etc, etc.).
    const segments = p.split(/[/\\]+/);
    return segments.some((seg) => seg === "..");
}

// Component to handle local image loading
function LocalImage({ src, alt, baseDir, ...props }: { src: string; alt: string; baseDir: string | null } & React.ImgHTMLAttributes<HTMLImageElement>) {
    const [imageSrc, setImageSrc] = useState<string>('');
    const [error, setError] = useState(false);

    useEffect(() => {
        if (!baseDir || !src) return;

        // External URLs and data: URIs go straight to the <img>.
        if (src.includes('://') || src.startsWith('data:')) {
            setImageSrc(src);
            setError(false);
            return;
        }

        // Strip a leading `./` then validate. Anything with a `..` segment, an
        // absolute prefix, or a drive letter is rejected — see
        // isUnsafeRelativePath above.
        const cleanPath = src.startsWith('./') ? src.slice(2) : src;
        if (isUnsafeRelativePath(cleanPath)) {
            setError(true);
            return;
        }

        const sep = baseDir.includes('\\') ? '\\' : '/';
        const fullPath = `${baseDir}${sep}${cleanPath.replace(/[/\\]/g, sep)}`;
        const ext = cleanPath.split('.').pop()?.toLowerCase() || 'png';
        const mimeType = IMAGE_MIME_TYPES[ext] || 'image/png';

        let cancelled = false;
        getCachedLocalImageUrl(fullPath, mimeType)
            .then((url) => {
                if (!cancelled) {
                    setImageSrc(url);
                    setError(false);
                }
            })
            .catch((err) => {
                console.error('Failed to load image:', err);
                if (!cancelled) setError(true);
            });

        return () => {
            cancelled = true;
            // Don't revoke the URL — the cache owns it. Cache eviction handles
            // revocation when the entry is pushed out by LRU pressure.
        };
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
            loading="lazy"
            className="max-w-full h-auto rounded-lg my-4 cursor-zoom-in transition-transform hover:scale-[1.01]"
            onClick={() => {
                const evt = new CustomEvent("marklite:zoom", { detail: { src: imageSrc, alt } });
                window.dispatchEvent(evt);
            }}
        />
    );
}

/** Pull className + raw text out of a react-markdown <pre><code>...</code></pre> child. */
function extractCodeChild(children: React.ReactNode): { className?: string; text: string } | null {
    // <pre>'s child is the <code> element React node
    if (!children || typeof children !== "object") return null;
    const arr = Array.isArray(children) ? children : [children];
    for (const child of arr) {
        if (child && typeof child === "object" && "props" in child) {
            const props = (child as { props: { className?: string; children?: React.ReactNode } }).props;
            return {
                className: props.className,
                text: nodeText(props.children),
            };
        }
    }
    return null;
}

/** Code block with a copy-to-clipboard button — also intercepts mermaid blocks. */
function CodeBlock({ children, ...rest }: React.HTMLAttributes<HTMLPreElement>) {
    const ref = useRef<HTMLPreElement>(null);
    const [copied, setCopied] = useState(false);

    const codeInfo = extractCodeChild(children);
    if (codeInfo && isMermaidLanguage(codeInfo.className)) {
        return <MermaidBlock code={codeInfo.text} />;
    }

    const handleCopy = async () => {
        const text = ref.current?.innerText ?? "";
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
        } catch {
            // ignore — clipboard may be unavailable in some webviews
        }
    };

    return (
        <div className="relative group">
            <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy code"
                className="absolute top-2 right-2 z-10 px-2 py-1 text-[11px] rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-opacity"
            >
                {copied ? "Copied!" : "Copy"}
            </button>
            <pre ref={ref} {...rest}>{children}</pre>
        </div>
    );
}

/** Render YAML frontmatter as a collapsible, editable metadata card. */
function FrontmatterCard({
    data,
    editable,
    onChange,
}: {
    data: Record<string, FrontmatterValue>;
    editable: boolean;
    onChange?: (next: Record<string, FrontmatterValue>) => void;
}) {
    const [collapsed, setCollapsed] = useState(false);
    const entries = Object.entries(data);
    if (entries.length === 0) return null;

    const updateKey = (k: string, v: FrontmatterValue) => onChange?.({ ...data, [k]: v });

    const renderValue = (k: string, v: FrontmatterValue) => {
        if (Array.isArray(v)) {
            return (
                <div className="flex flex-wrap gap-1 items-center">
                    {v.map((item, i) => (
                        <span key={i} className="px-2 py-0.5 text-xs bg-[var(--bg-hover)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] text-[var(--text-primary)] flex items-center gap-1">
                            {item}
                            {editable && (
                                <button
                                    type="button"
                                    onClick={() => updateKey(k, v.filter((_, idx) => idx !== i))}
                                    aria-label={`Remove ${item}`}
                                    className="opacity-50 hover:opacity-100"
                                >
                                    <span className="material-symbols-outlined text-[12px]">close</span>
                                </button>
                            )}
                        </span>
                    ))}
                    {editable && (
                        <input
                            type="text"
                            placeholder="+ add"
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    const val = e.currentTarget.value.trim();
                                    if (val) {
                                        updateKey(k, [...v, val]);
                                        e.currentTarget.value = "";
                                    }
                                }
                            }}
                            className="px-1.5 py-0.5 text-xs bg-transparent border border-dashed border-[var(--border)] rounded-[var(--radius-sm)] text-[var(--text-secondary)] outline-none focus:border-[var(--accent)] w-20"
                        />
                    )}
                </div>
            );
        }
        if (typeof v === "boolean") {
            if (editable) {
                return (
                    <button
                        type="button"
                        onClick={() => updateKey(k, !v)}
                        className={`relative inline-block w-9 h-5 rounded-full transition-colors ${v ? "bg-[var(--accent)]" : "bg-[var(--border)]"}`}
                        aria-pressed={v}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${v ? "translate-x-4" : ""}`} />
                    </button>
                );
            }
            return <span className="text-xs font-mono">{v ? "true" : "false"}</span>;
        }
        if (editable) {
            return (
                <input
                    type={typeof v === "number" ? "number" : "text"}
                    defaultValue={String(v)}
                    onBlur={(e) => {
                        const raw = e.target.value;
                        const next: FrontmatterValue = typeof v === "number" ? Number(raw) : raw;
                        if (next !== v) updateKey(k, next);
                    }}
                    className="w-full px-2 py-0.5 text-sm bg-transparent border-b border-transparent hover:border-[var(--border)] focus:border-[var(--accent)] outline-none text-[var(--text-primary)]"
                />
            );
        }
        return <span className="text-sm">{String(v)}</span>;
    };

    return (
        <div className="mb-6 border border-[var(--border)] rounded-[var(--radius-md)] overflow-hidden bg-[var(--bg-secondary)]">
            <button
                type="button"
                onClick={() => setCollapsed((c) => !c)}
                className="w-full flex items-center justify-between px-4 py-2 text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider hover:bg-[var(--bg-hover)] transition-colors"
                aria-expanded={!collapsed}
            >
                <span className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">tune</span>
                    Properties
                </span>
                <span className="material-symbols-outlined text-[18px]">
                    {collapsed ? "expand_more" : "expand_less"}
                </span>
            </button>
            {!collapsed && (
                <div className="px-4 py-3 border-t border-[var(--border-subtle)]">
                    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm items-center">
                        {entries.map(([k, v]) => (
                            <div key={k} className="contents">
                                <dt className="font-mono text-xs text-[var(--text-muted)]">{k}</dt>
                                <dd className="text-[var(--text-primary)]">{renderValue(k, v)}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            )}
        </div>
    );
}

/** Interactive task checkbox — local optimistic state, parent writes to source. */
function InteractiveTaskCheckbox({ initialChecked, onToggle }: { initialChecked: boolean; onToggle: (checked: boolean) => void }) {
    const [checked, setChecked] = useState(initialChecked);
    useEffect(() => setChecked(initialChecked), [initialChecked]);
    return (
        <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
                const next = e.target.checked;
                setChecked(next);
                onToggle(next);
            }}
            className="mr-2 cursor-pointer accent-[var(--accent)]"
        />
    );
}

/** Heading with click-to-copy permalink (GitHub-style). */
function HeadingWithAnchor(
    props: { level: 1 | 2 | 3 | 4 | 5 | 6 } & React.HTMLAttributes<HTMLHeadingElement>
) {
    const { level, children, className, ...rest } = props;
    const text = nodeText(children);
    const id = slugify(text);
    const handleClick = () => {
        const el = document.getElementById(id);
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    const inner = (
        <>
            <span>{children}</span>
            <button
                type="button"
                onClick={handleClick}
                aria-label={`Jump to ${text}`}
                className="opacity-0 group-hover/heading:opacity-60 hover:!opacity-100 text-[var(--text-muted)] hover:text-[var(--accent)] transition-opacity"
                tabIndex={-1}
            >
                <span className="material-symbols-outlined" style={{ fontSize: "0.7em", verticalAlign: "middle" }}>link</span>
            </button>
        </>
    );
    const sharedProps = {
        id,
        ...rest,
        className: `${className ?? ""} group/heading flex items-baseline gap-2`,
    };
    switch (level) {
        case 1: return <h1 {...sharedProps}>{inner}</h1>;
        case 2: return <h2 {...sharedProps}>{inner}</h2>;
        case 3: return <h3 {...sharedProps}>{inner}</h3>;
        case 4: return <h4 {...sharedProps}>{inner}</h4>;
        case 5: return <h5 {...sharedProps}>{inner}</h5>;
        case 6: return <h6 {...sharedProps}>{inner}</h6>;
    }
}

function MarkdownPreviewImpl({
    content,
    onLineChange,
    filePath,
    markdownBodyRef,
    onContentChange,
    onScrollFraction,
    registerScroller,
    onWikilinkClick,
}: MarkdownPreviewProps) {
    const mainRef = useRef<HTMLElement>(null);
    const [zoomImage, setZoomImage] = useState<{ src: string; alt: string } | null>(null);

    // lineCount is derived here (instead of being passed as a prop) so the
    // preview's split happens once, against the same `content` we render.
    // App used to compute this from live content and pass it down, which
    // double-scanned the document on every keystroke and reported the wrong
    // count for the (debounced) snapshot we're actually rendering.
    const lineCount = useMemo(() => content.split("\n").length, [content]);

    // Listen for zoom requests from LocalImage clicks
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.src) setZoomImage({ src: detail.src, alt: detail.alt || "" });
        };
        window.addEventListener("marklite:zoom", handler);
        return () => window.removeEventListener("marklite:zoom", handler);
    }, []);

    // Esc closes lightbox
    useEffect(() => {
        if (!zoomImage) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setZoomImage(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [zoomImage]);

    // Get the directory containing the markdown file
    const baseDir = useMemo(() => {
        if (!filePath) return null;
        const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
        return lastSep > 0 ? filePath.slice(0, lastSep) : null;
    }, [filePath]);

    // Toggle a task list checkbox by index — write back to the source markdown.
    // Counts task items in document order; toggles the Nth one.
    // SKIPS lines inside fenced code blocks so a literal `- [ ] foo` written
    // in a documentation example doesn't shift the index of the real tasks.
    const handleTaskToggle = useCallback((index: number, checked: boolean) => {
        if (!onContentChange) return;
        const lines = content.split("\n");
        let count = 0;
        let inFence = false;
        const fenceRe = /^(\s*)(```|~~~)/;
        const taskRe = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)/;
        for (let i = 0; i < lines.length; i++) {
            if (fenceRe.test(lines[i])) {
                inFence = !inFence;
                continue;
            }
            if (inFence) continue;
            const m = lines[i].match(taskRe);
            if (m) {
                if (count === index) {
                    lines[i] = lines[i].replace(taskRe, `$1${checked ? "x" : " "}$3`);
                    onContentChange(lines.join("\n"));
                    return;
                }
                count++;
            }
        }
    }, [content, onContentChange]);

    const components = useMemo(() => ({
        img: ({ src, alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => (
            <LocalImage src={src || ''} alt={alt || 'image'} baseDir={baseDir} {...props} />
        ),
        a: ({ href, children, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => {
            // Wikilink: open same-folder file via callback
            if (href && href.startsWith("wikilink:")) {
                const target = decodeURIComponent(href.slice("wikilink:".length));
                return (
                    <a
                        {...rest}
                        href="#"
                        onClick={(e) => {
                            e.preventDefault();
                            onWikilinkClick?.(target);
                        }}
                        className="text-[var(--syntax-link)] border-b border-dashed border-[var(--syntax-link)] hover:opacity-80"
                        title={`Wikilink: ${target}`}
                    >
                        {children}
                    </a>
                );
            }
            // In-page hash link (#section). The Tauri webview's URL doesn't
            // play well with native hash navigation, so we scroll explicitly.
            // Falls back to a fuzzy heading-text match when the slug doesn't
            // exactly match an existing id (different markdown anchor styles).
            if (href && href.startsWith("#")) {
                return (
                    <a
                        {...rest}
                        href={href}
                        onClick={(e) => {
                            e.preventDefault();
                            const id = decodeURIComponent(href.slice(1));
                            let el: HTMLElement | null = document.getElementById(id);
                            if (!el) {
                                // Fuzzy fallback: find a heading whose textContent
                                // slugifies to a string containing the requested id.
                                const needle = id.toLowerCase().replace(/-/g, " ").trim();
                                const headings = document.querySelectorAll<HTMLElement>(
                                    ".markdown-body h1, .markdown-body h2, .markdown-body h3, .markdown-body h4, .markdown-body h5, .markdown-body h6"
                                );
                                for (const h of headings) {
                                    const text = (h.textContent ?? "").toLowerCase();
                                    if (text.includes(needle) || needle.includes(text.trim())) {
                                        el = h;
                                        break;
                                    }
                                }
                            }
                            el?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                    >
                        {children}
                    </a>
                );
            }
            // External http(s) and mailto links — route through the OS default
            // handler so the webview itself doesn't navigate away from the app.
            const isExternal = !!href && /^(https?:|mailto:)/i.test(href);
            return (
                <a
                    href={href}
                    {...rest}
                    {...(isExternal
                        ? { rel: "noopener noreferrer", target: "_blank" }
                        : {})}
                    onClick={(e) => {
                        if (!isExternal || !href) return;
                        e.preventDefault();
                        openUrl(href).catch((err) =>
                            console.error("Failed to open external URL:", err)
                        );
                    }}
                >
                    {children}
                </a>
            );
        },
        pre: (props: React.HTMLAttributes<HTMLPreElement>) => <CodeBlock {...props} />,
        h1: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={1} {...props} />,
        h2: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={2} {...props} />,
        h3: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={3} {...props} />,
        h4: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={4} {...props} />,
        h5: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={5} {...props} />,
        h6: (props: React.HTMLAttributes<HTMLHeadingElement>) => <HeadingWithAnchor level={6} {...props} />,
        // Interactive task checkbox: react-markdown + remarkGfm renders <input type="checkbox" disabled />.
        // We capture the task's positional index AT RENDER TIME (so each <input>'s
        // closure remembers its own index) — not on click. The previous form
        // `onToggle={(c) => handleTaskToggle(counter.current++, c)}` incremented
        // the counter on click, which meant clicking any checkbox toggled the
        // (click-count)-th task in source order, not the task that was actually
        // clicked. The capture-on-render form always toggles the right task.
        input: ({ type, checked, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) => {
            if (type !== "checkbox") return <input type={type} checked={checked} {...rest} />;
            const idx = taskCheckboxCounter.current++;
            return (
                <InteractiveTaskCheckbox
                    initialChecked={!!checked}
                    onToggle={(c) => handleTaskToggle(idx, c)}
                />
            );
        },
    }), [baseDir, handleTaskToggle, onWikilinkClick]);

    // Reset the task index counter on every render so the next render starts at 0.
    // react-markdown traverses the AST top-to-bottom inside the same render
    // pass, so by the time react-markdown finishes the counter equals the
    // total task count. StrictMode dev double-invokes the render body but
    // resets the counter at the top of each pass, so each <input>'s captured
    // idx is consistent regardless of which pass committed.
    const taskCheckboxCounter = useRef(0);
    taskCheckboxCounter.current = 0;

    // Parse YAML frontmatter once per content change. We render it as a
    // metadata card and pass the *body* (without the --- block) to react-markdown
    // so the raw YAML doesn't appear as a thematic break + heading.
    const { body: parsedBody, data: frontmatter, hasFrontmatter } = useMemo(
        () => parseFrontmatter(content),
        [content]
    );

    // Pre-process wikilinks: [[Foo]] and [[Foo|alias]] → [alias](wikilink:Foo).
    // We use a custom href scheme so the link click handler can detect them
    // and load the target file, while keeping the source markdown portable
    // (the source still has [[Foo]] — only the rendered output uses the scheme).
    const renderBody = useMemo(() => {
        return parsedBody.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => {
            const t = target.trim();
            const a = (alias ?? target).trim();
            return `[${a}](wikilink:${encodeURIComponent(t)})`;
        });
    }, [parsedBody]);

    // Lazy-load KaTeX only when the document actually contains math.
    // Heavy (~280kb) — keeping it out of the initial bundle is a real win.
    const [mathPlugins, setMathPlugins] = useState<PluginPair | null>(mathPluginsCache);
    useEffect(() => {
        if (mathPlugins) return;
        if (!hasMath(renderBody)) return;
        let cancelled = false;
        loadMathPlugins().then((p) => {
            if (!cancelled) setMathPlugins(p);
        });
        return () => { cancelled = true; };
    }, [renderBody, mathPlugins]);

    const remarkPlugins = useMemo(
        () => (mathPlugins ? [remarkGfm, mathPlugins.remark] : [remarkGfm]),
        [mathPlugins]
    );
    const rehypePlugins = useMemo(
        () => (mathPlugins ? [rehypeHighlight, mathPlugins.rehype] : [rehypeHighlight]),
        [mathPlugins]
    );

    // Track scroll: update active-line indicator + report fraction for split-sync.
    const handleScroll = useCallback(() => {
        const element = mainRef.current;
        if (!element) return;

        const scrollTop = element.scrollTop;
        const scrollHeight = element.scrollHeight - element.clientHeight;
        const fraction = scrollHeight > 0 ? scrollTop / scrollHeight : 0;

        if (onLineChange) {
            const currentLine = scrollHeight <= 0 ? 1 : Math.max(1, Math.ceil(fraction * lineCount));
            onLineChange(currentLine);
        }
        onScrollFraction?.(fraction);
    }, [lineCount, onLineChange, onScrollFraction]);

    // Set up scroll listener
    useEffect(() => {
        const element = mainRef.current;
        if (!element) return;

        element.addEventListener("scroll", handleScroll);
        handleScroll();

        return () => {
            element.removeEventListener("scroll", handleScroll);
        };
    }, [handleScroll]);

    // Register imperative scroller for split-view sync
    useEffect(() => {
        if (!registerScroller) return;
        registerScroller({
            setFraction: (f: number) => {
                const el = mainRef.current;
                if (!el) return;
                const max = el.scrollHeight - el.clientHeight;
                if (max > 0) el.scrollTop = max * f;
            },
        });
        return () => registerScroller(null);
    }, [registerScroller]);

    return (
        <>
            <main
                ref={mainRef}
                className="flex-1 overflow-y-auto bg-[var(--bg-primary)] transition-colors"
            >
                <div className="max-w-[800px] mx-auto px-8 py-12">
                    {hasFrontmatter && (
                        <FrontmatterCard
                            data={frontmatter}
                            editable={!!onContentChange}
                            onChange={(next) => {
                                if (!onContentChange) return;
                                onContentChange(serializeFrontmatter(next, parsedBody));
                            }}
                        />
                    )}
                    <div className="markdown-body" ref={markdownBodyRef}>
                        <Markdown
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            remarkPlugins={remarkPlugins as any}
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            rehypePlugins={rehypePlugins as any}
                            components={components}
                        >
                            {renderBody}
                        </Markdown>
                    </div>
                </div>
            </main>

            {zoomImage && (
                <div
                    role="dialog"
                    aria-label={`Image: ${zoomImage.alt || "preview"}`}
                    className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-zoom-out animate-fade-in"
                    onClick={() => setZoomImage(null)}
                >
                    <img
                        src={zoomImage.src}
                        alt={zoomImage.alt}
                        className="max-w-[95vw] max-h-[95vh] object-contain rounded-lg shadow-2xl"
                        onClick={(e) => e.stopPropagation()}
                    />
                    <button
                        type="button"
                        onClick={() => setZoomImage(null)}
                        aria-label="Close image"
                        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center backdrop-blur"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>
            )}
        </>
    );
}

// React.memo so we skip the heavy markdown re-parse + reconcile when only
// the editor cursor moved or selection changed. App re-renders on every
// keystroke (live `content` state); without memo, that re-render flowed
// straight through and called react-markdown again with the same input.
// All inputs to MarkdownPreview are either stable (callbacks via useCallback,
// filePath/fileName) or genuine work triggers (debounced content) — the
// default shallow prop comparator is exactly what we want.
export const MarkdownPreview = memo(MarkdownPreviewImpl);
