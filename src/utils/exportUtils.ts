import { Theme, FontFamily, FontSize } from '../context/ThemeContext';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

// Theme color definitions for export
const themeColors: Record<Theme, Record<string, string>> = {
    dark: {
        bgPrimary: '#0a0a0a',
        bgSecondary: '#141414',
        textPrimary: '#ffffff',
        textSecondary: '#737373',
        border: '#262626',
        codeBg: '#141414',
        codeText: '#a3a3a3',
        blockquoteBg: 'rgba(20, 20, 20, 0.8)',
        accent: '#ffffff',
        syntaxH1: '#ffffff',
        syntaxH2: '#e5e5e5',
        syntaxH3: '#d4d4d4',
        syntaxLink: '#a3a3a3',
        syntaxBold: '#ffffff',
    },
    light: {
        bgPrimary: '#ffffff',
        bgSecondary: '#fafafa',
        textPrimary: '#171717',
        textSecondary: '#525252',
        border: '#e5e5e5',
        codeBg: '#f5f5f5',
        codeText: '#dc2626',
        blockquoteBg: 'rgba(250, 250, 250, 0.8)',
        accent: '#171717',
        syntaxH1: '#171717',
        syntaxH2: '#262626',
        syntaxH3: '#404040',
        syntaxLink: '#2563eb',
        syntaxBold: '#171717',
    },
    paper: {
        bgPrimary: '#f5f0e6',
        bgSecondary: '#ebe5d8',
        textPrimary: '#3d3d3d',
        textSecondary: '#6b6352',
        border: '#d4cfc2',
        codeBg: '#ebe5d8',
        codeText: '#8b5a2b',
        blockquoteBg: 'rgba(235, 229, 216, 0.6)',
        accent: '#5c4033',
        syntaxH1: '#3d3029',
        syntaxH2: '#5c4033',
        syntaxH3: '#6b5344',
        syntaxLink: '#2d5a7b',
        syntaxBold: '#5c4033',
    },
    dracula: {
        bgPrimary: '#282a36',
        bgSecondary: '#343746',
        textPrimary: '#f8f8f2',
        textSecondary: '#d6d6d6',
        border: '#44475a',
        codeBg: '#21222c',
        codeText: '#f8f8f2',
        blockquoteBg: 'rgba(68, 71, 90, 0.35)',
        accent: '#bd93f9',
        syntaxH1: '#ff79c6',
        syntaxH2: '#ff79c6',
        syntaxH3: '#bd93f9',
        syntaxLink: '#8be9fd',
        syntaxBold: '#f8f8f2',
    },
};

// Font family definitions
const fontFamilies: Record<FontFamily, string> = {
    'inter': "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    'merriweather': "'Merriweather', Georgia, 'Times New Roman', serif",
    'lora': "'Lora', Georgia, 'Times New Roman', serif",
    'source-serif': "'Source Serif 4', Georgia, 'Times New Roman', serif",
    'fira-sans': "'Fira Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
};

// Font size definitions
const fontSizes: Record<FontSize, { base: string; h1: string; h2: string; h3: string; lineHeight: string }> = {
    small: { base: '14px', h1: '1.875em', h2: '1.5em', h3: '1.125em', lineHeight: '1.6' },
    medium: { base: '16px', h1: '2.25em', h2: '1.75em', h3: '1.25em', lineHeight: '1.7' },
    large: { base: '18px', h1: '2.5em', h2: '2em', h3: '1.375em', lineHeight: '1.8' },
};

// Generate CSS for export
function generateExportCSS(theme: Theme, font: FontFamily, fontSize: FontSize): string {
    const colors = themeColors[theme];
    const fontFamily = fontFamilies[font];
    const sizes = fontSizes[fontSize];

    // No Google Fonts @import here — exporting must succeed offline, and the
    // resulting HTML must render reasonably on machines that can't reach the
    // CDN. The font-family declarations below use the same display names as
    // the editor (Inter, Merriweather, Lora, Source Serif 4, Fira Sans,
    // JetBrains Mono); the recipient sees those if installed locally,
    // otherwise the cascade falls back to a safe system font in the same
    // genre (sans-serif, serif, or monospace).
    return `
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: ${fontFamily};
            font-size: ${sizes.base};
            line-height: ${sizes.lineHeight};
            background-color: ${colors.bgPrimary};
            color: ${colors.textPrimary};
            -webkit-font-smoothing: antialiased;
            -moz-osx-font-smoothing: grayscale;
            padding: 3rem;
            max-width: 800px;
            margin: 0 auto;
        }

        @page {
            margin: 18mm 16mm;
        }

        @media print {
            html, body {
                background: #ffffff;
            }
            body {
                padding: 0;
                max-width: none;
                color: #171717;
            }
            /* Browsers drop background fills when printing unless asked; keep
               code blocks, table headers and blockquote tints visible. */
            pre, code, th, blockquote, .hljs {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            /* Keep atomic blocks and their headings from splitting awkwardly. */
            pre, blockquote, table, img, tr {
                page-break-inside: avoid;
                break-inside: avoid;
            }
            h1, h2, h3, h4, h5, h6 {
                page-break-after: avoid;
                break-after: avoid;
            }
        }

        h1 {
            font-size: ${sizes.h1};
            font-weight: 800;
            padding-bottom: 0.3em;
            border-bottom: 1px solid ${colors.border};
            color: ${colors.syntaxH1};
            margin-bottom: 1rem;
            margin-top: 0;
        }

        h2 {
            font-size: ${sizes.h2};
            font-weight: 700;
            padding-bottom: 0.3em;
            border-bottom: 1px solid ${colors.border};
            color: ${colors.syntaxH2};
            margin-top: 2rem;
            margin-bottom: 1rem;
        }

        h3 {
            font-size: ${sizes.h3};
            font-weight: 600;
            color: ${colors.syntaxH3};
            margin-top: 1.5rem;
            margin-bottom: 0.5rem;
        }

        h4, h5, h6 {
            font-weight: 600;
            color: ${colors.syntaxH3};
            margin-top: 1.25rem;
            margin-bottom: 0.5rem;
        }

        p {
            margin-bottom: 1rem;
        }

        a {
            color: ${colors.syntaxLink};
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        strong {
            font-weight: 600;
            color: ${colors.syntaxBold};
        }

        em {
            font-style: italic;
        }

        code {
            font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
            background: ${colors.codeBg};
            border: 1px solid ${colors.border};
            border-radius: 0.25rem;
            padding: 0.1em 0.3em;
            font-size: 0.875em;
            color: ${colors.codeText};
        }

        pre {
            background: ${colors.codeBg};
            border: 1px solid ${colors.border};
            border-radius: 0.375rem;
            padding: 1rem;
            overflow-x: auto;
            margin: 1rem 0;
        }

        pre code {
            background: none;
            border: none;
            padding: 0;
            color: ${colors.textPrimary};
            font-size: 0.9em;
        }

        ul, ol {
            padding-left: 1.5rem;
            margin-bottom: 1rem;
        }

        li {
            margin-bottom: 0.25rem;
        }

        li > ul, li > ol {
            margin-top: 0.25rem;
            margin-bottom: 0;
        }

        blockquote {
            border-left: 4px solid ${colors.accent};
            background: ${colors.blockquoteBg};
            padding: 0.5rem 1rem;
            margin: 1rem 0;
            font-style: italic;
            color: ${colors.textSecondary};
            border-radius: 0 0.25rem 0.25rem 0;
        }

        blockquote p:last-child {
            margin-bottom: 0;
        }

        hr {
            border: none;
            border-top: 1px solid ${colors.border};
            margin: 2rem 0;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin: 1rem 0;
        }

        th, td {
            border: 1px solid ${colors.border};
            padding: 0.5rem 0.75rem;
            text-align: left;
        }

        th {
            background: ${colors.bgSecondary};
            font-weight: 600;
        }

        img {
            max-width: 100%;
            height: auto;
            border-radius: 0.375rem;
            margin: 1rem 0;
        }

        /* Task lists */
        input[type="checkbox"] {
            margin-right: 0.5rem;
            transform: scale(1.1);
        }

        /* Syntax highlighting */
        .hljs-keyword { color: ${colors.syntaxH2}; }
        .hljs-string { color: ${colors.syntaxBold}; }
        .hljs-number { color: ${colors.syntaxH1}; }
        .hljs-function { color: #22c55e; }
        .hljs-comment { color: ${colors.textSecondary}; font-style: italic; }
        .hljs-title { color: #22c55e; }
        .hljs-params { color: ${colors.textSecondary}; }
        .hljs-built_in { color: ${colors.syntaxLink}; }
        .hljs-attr { color: #22c55e; }
        .hljs-literal { color: ${colors.syntaxH1}; }

        /* Footer */
        .export-footer {
            margin-top: 3rem;
            padding-top: 1rem;
            border-top: 1px solid ${colors.border};
            text-align: center;
            font-size: 0.75rem;
            color: ${colors.textSecondary};
        }
    `;
}

/**
 * Clean the live preview's innerHTML for export (EXPORT-01):
 *  - strips UI chrome that leaked in from interactive renderers: code-block
 *    "Copy" buttons and heading anchor buttons (whose Material Symbols
 *    ligatures render as literal words like "link" without the icon font);
 *  - inlines blob: image URLs as data: URIs — blob URLs are session-bound, so
 *    exported files referencing them show broken images;
 *  - neutralizes wikilink: hrefs (app-internal scheme) into plain text.
 */
export async function prepareExportHtml(rawHtml: string): Promise<string> {
    const doc = new DOMParser().parseFromString(`<div id="__export_root">${rawHtml}</div>`, "text/html");
    const root = doc.getElementById("__export_root");
    if (!root) return rawHtml;

    root.querySelectorAll("button").forEach((b) => b.remove());
    root.querySelectorAll(".material-symbols-outlined").forEach((s) => s.remove());

    root.querySelectorAll("a[href^='wikilink:']").forEach((a) => {
        const span = doc.createElement("span");
        span.textContent = a.textContent;
        a.replaceWith(span);
    });

    for (const img of Array.from(root.querySelectorAll("img"))) {
        const src = img.getAttribute("src") || "";
        if (!src.startsWith("blob:")) continue;
        try {
            const blob = await (await fetch(src)).blob();
            const dataUri = await new Promise<string>((resolve, reject) => {
                const fr = new FileReader();
                fr.onload = () => resolve(fr.result as string);
                fr.onerror = () => reject(fr.error);
                fr.readAsDataURL(blob);
            });
            img.setAttribute("src", dataUri);
        } catch {
            // Blob already revoked or unreadable — leave the src; the alt text
            // still communicates what belonged there.
        }
    }

    return root.innerHTML;
}

// Escape HTML entities to prevent XSS in generated HTML
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Generate standalone HTML document
export function generateHTML(
    htmlContent: string,
    title: string,
    theme: Theme,
    font: FontFamily,
    fontSize: FontSize,
    includeFooter: boolean = true
): string {
    const css = generateExportCSS(theme, font, fontSize);
    const safeTitle = escapeHtml(title);
    const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const footer = includeFooter
        ? `<footer class="export-footer">Exported from Paperling on ${date}</footer>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="generator" content="Paperling">
    <meta name="date" content="${new Date().toISOString()}">
    <title>${safeTitle}</title>
    <style>${css}</style>
</head>
<body>
    <article>
        ${htmlContent}
    </article>
    ${footer}
</body>
</html>`;
}

// Export to HTML file. Resolves `true` when a file was actually written, and
// `false` when the user cancelled the save dialog — so the caller can skip the
// "Exported" confirmation toast on cancel.
export async function exportToHTML(
    htmlContent: string,
    fileName: string,
    theme: Theme,
    font: FontFamily,
    fontSize: FontSize
): Promise<boolean> {
    const title = fileName.replace(/\.(md|markdown)$/i, '');
    const cleaned = await prepareExportHtml(htmlContent);
    const fullHTML = generateHTML(cleaned, title, theme, font, fontSize);

    // Use Tauri save dialog
    const filePath = await save({
        defaultPath: `${title}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
    });

    if (!filePath) return false;
    await writeTextFile(filePath, fullHTML);
    return true;
}

// ---------------------------------------------------------------------------
// DOCX export
//
// Converts the same cleaned preview HTML we use for HTML/PDF into a real Office
// Open XML (.docx) document via @turbodocx/html-to-docx — pure JS, no headless
// browser or native binary, and Vite resolves its dedicated browser ESM build.
// The library is dynamically imported so its weight stays out of the main chunk
// (and off the cold-start path) until the user actually exports to Word.
//
// Like PDF, DOCX is always a light, print-style document — a shared Word file
// must be legible on white. Headings, lists, tables, bold/italic, links, and
// images (inlined as data URIs by prepareExportHtml) carry over faithfully. Math
// (KaTeX) and Mermaid diagrams are HTML/SVG constructs Word has no native model
// for, so they degrade to their textual/markup form — the same caveat every
// Markdown-to-Word path has. EXPORT-02.
type HtmlToDocx = (
    html: string,
    header?: string | null,
    options?: Record<string, unknown>,
    footer?: string | null
) => Promise<ArrayBuffer | Blob | Uint8Array>;

export async function exportToDocx(
    htmlContent: string,
    fileName: string,
    _theme: Theme,
    _font: FontFamily,
    _fontSize: FontSize
): Promise<boolean> {
    if (!htmlContent || htmlContent.trim() === '') {
        console.error('No HTML content to export!');
        return false;
    }

    const title = fileName.replace(/\.(md|markdown)$/i, '');
    const cleaned = await prepareExportHtml(htmlContent);
    // A minimal, unthemed document — the converter maps semantic HTML to Word
    // styles, so we deliberately don't inject the screen theme's colors here.
    const docHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><article>${cleaned}</article></body></html>`;

    // Prompt for the destination first so we don't do the (heavier) conversion
    // work when the user is just going to cancel.
    const filePath = await save({
        defaultPath: `${title}.docx`,
        filters: [{ name: 'Word Document', extensions: ['docx'] }],
    });
    if (!filePath) return false;

    const mod = await import('@turbodocx/html-to-docx');
    // The package uses `export =`; the function is the default export under the
    // browser/ESM build. Fall back to the namespace itself for the CJS shape.
    const convert = ((mod as { default?: HtmlToDocx }).default ?? (mod as unknown as HtmlToDocx)) as HtmlToDocx;

    const out = await convert(docHtml, null, {
        title,
        creator: 'Paperling',
        footer: false,
        pageNumber: false,
        font: 'Calibri',
        // Word measures run size in half-points; 22 == 11pt body text.
        fontSize: 22,
        table: { row: { cantSplit: true } },
    });

    const bytes =
        out instanceof Blob ? new Uint8Array(await out.arrayBuffer())
        : out instanceof Uint8Array ? out
        : new Uint8Array(out as ArrayBuffer);
    await writeFile(filePath, bytes);
    return true;
}

// ---------------------------------------------------------------------------
// PDF export
//
// We deliberately do NOT rasterize or hand-roll a PDF layout. Instead we render
// the same standalone HTML we produce for HTML export inside an isolated,
// off-screen iframe and drive the webview's own print pipeline ("Save as PDF" /
// "Microsoft Print to PDF"). That yields a vector PDF that matches the preview
// exactly: real Unicode and color emoji, selectable/searchable text and working
// links — none of which the old jsPDF standard-font path could do (it encoded
// text as single-byte WinAnsi, so anything outside Latin-1 — emoji, smart
// quotes, em dashes — printed as garbage).
// ---------------------------------------------------------------------------

const PRINT_FRAME_ID = '__paperling_print_frame';

// Resolve once every <img> has finished loading (or failed) so the print job
// never captures half-decoded images. Sources are inlined as data: URIs by
// prepareExportHtml, so this usually settles almost immediately.
function waitForImages(doc: Document): Promise<void> {
    const imgs = Array.from(doc.images ?? []);
    return Promise.all(
        imgs.map((img) =>
            img.complete
                ? Promise.resolve()
                : new Promise<void>((resolve) => {
                      img.addEventListener('load', () => resolve(), { once: true });
                      img.addEventListener('error', () => resolve(), { once: true });
                  })
        )
    ).then(() => undefined);
}

// Render `html` in a hidden iframe and invoke the webview's native print dialog.
// Resolves once printing has been triggered and cleaned up (or the dialog was
// dismissed). A webview that never fires `afterprint` is cleaned up by the
// fallback timer so we don't leak frames.
function printHtmlDocument(html: string): Promise<void> {
    return new Promise((resolve) => {
        // Remove any frame left over from a previous (e.g. cancelled) export.
        document.getElementById(PRINT_FRAME_ID)?.remove();

        const iframe = document.createElement('iframe');
        iframe.id = PRINT_FRAME_ID;
        iframe.setAttribute('aria-hidden', 'true');
        iframe.setAttribute('tabindex', '-1');
        Object.assign(iframe.style, {
            position: 'fixed',
            left: '-9999px',
            top: '0',
            // A4-ish width at 96dpi so on-screen layout is sane before the print
            // engine re-flows to the real page size.
            width: '794px',
            height: '0',
            border: '0',
            opacity: '0',
            pointerEvents: 'none',
        });

        let settled = false;
        const finish = () => {
            if (!settled) {
                settled = true;
                resolve();
            }
        };

        iframe.onload = () => {
            const win = iframe.contentWindow;
            if (!win) {
                iframe.remove();
                finish();
                return;
            }

            let fallbackTimer: ReturnType<typeof setTimeout>;
            const cleanup = () => {
                win.removeEventListener('afterprint', cleanup);
                clearTimeout(fallbackTimer);
                // Defer removal a tick — some engines read the document
                // asynchronously after print() returns.
                setTimeout(() => iframe.remove(), 300);
                finish();
            };
            // Fires when the dialog closes, whether the user saved or cancelled.
            win.addEventListener('afterprint', cleanup);
            // Safety net for webviews that don't emit afterprint.
            fallbackTimer = setTimeout(cleanup, 120000);

            Promise.all([
                win.document.fonts?.ready?.catch(() => undefined),
                waitForImages(win.document),
            ]).then(() => {
                try {
                    win.focus();
                    win.print();
                } catch {
                    cleanup();
                }
            });
        };

        document.body.appendChild(iframe);
        iframe.srcdoc = html;
    });
}

// Export to PDF. The theme argument is intentionally ignored: a shared/printed
// PDF must be legible on white paper, so we always render the light theme. The
// on-screen HTML export still honours the chosen theme.
//
// On Windows we ask once where to save (like HTML export) and hand the HTML to
// the Rust `export_pdf` command, which renders it in a hidden WebView2 and
// writes a real PDF via the native PrintToPdf engine — no print dialog. Other
// platforms fall back to the webview's print pipeline (`window.print()`), the
// only cross-platform route to a vector PDF without bundling a headless browser.
// Resolves:
//   'saved'    — Windows: the PDF was written to the chosen path.
//   'cancelled'— Windows: the user dismissed the save dialog.
//   'printing' — other platforms: the native print dialog was handed off. We
//                can't tell save from cancel there, so the caller must NOT claim
//                "Exported" — the system dialog is its own feedback. EXPORT-01.
export type PdfExportResult = 'saved' | 'cancelled' | 'printing';

export async function exportToPDF(
    htmlContent: string,
    fileName: string,
    _theme: Theme,
    font: FontFamily,
    fontSize: FontSize
): Promise<PdfExportResult> {
    if (!htmlContent || htmlContent.trim() === '') {
        console.error('No HTML content to export!');
        return 'cancelled';
    }

    const title = fileName.replace(/\.(md|markdown)$/i, '');

    // Same cleanup as HTML export — strips UI chrome (copy buttons, heading
    // anchor icons) and inlines blob: images as data: URIs.
    const cleaned = await prepareExportHtml(htmlContent);
    const fullHTML = generateHTML(cleaned, title, 'light', font, fontSize, true);

    const isWindows =
        typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);

    if (isWindows) {
        const filePath = await save({
            defaultPath: `${title}.pdf`,
            filters: [{ name: 'PDF', extensions: ['pdf'] }],
        });
        // Dialog cancelled — nothing to do.
        if (!filePath) return 'cancelled';
        await invoke('export_pdf', { html: fullHTML, path: filePath });
        return 'saved';
    }

    await printHtmlDocument(fullHTML);
    return 'printing';
}
