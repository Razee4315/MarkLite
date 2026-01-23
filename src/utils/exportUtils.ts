import { Theme, FontFamily, FontSize } from '../context/ThemeContext';
import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile, writeFile } from '@tauri-apps/plugin-fs';
import { jsPDF } from 'jspdf';

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

    return `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Merriweather:wght@400;700&family=Lora:wght@400;600;700&family=Source+Serif+4:wght@400;600;700&family=Fira+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

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

        @media print {
            body {
                padding: 0;
                background: white;
                color: #171717;
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
    const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const footer = includeFooter
        ? `<footer class="export-footer">Exported from MarkLite on ${date}</footer>`
        : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="generator" content="MarkLite">
    <meta name="date" content="${new Date().toISOString()}">
    <title>${title}</title>
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

// Export to HTML file
export async function exportToHTML(
    htmlContent: string,
    fileName: string,
    theme: Theme,
    font: FontFamily,
    fontSize: FontSize
): Promise<void> {
    const title = fileName.replace(/\.(md|markdown)$/i, '');
    const fullHTML = generateHTML(htmlContent, title, theme, font, fontSize);

    // Use Tauri save dialog
    const filePath = await save({
        defaultPath: `${title}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
    });

    if (filePath) {
        await writeTextFile(filePath, fullHTML);
    }
}

// PDF font size mappings
const pdfFontSizes: Record<FontSize, { base: number; h1: number; h2: number; h3: number; code: number; lineHeight: number }> = {
    small: { base: 10, h1: 20, h2: 16, h3: 12, code: 9, lineHeight: 1.4 },
    medium: { base: 11, h1: 22, h2: 18, h3: 14, code: 10, lineHeight: 1.5 },
    large: { base: 12, h1: 24, h2: 20, h3: 16, code: 11, lineHeight: 1.6 },
};

// Parse HTML and extract structured content for PDF
interface PDFElement {
    type: 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'code' | 'blockquote' | 'hr' | 'pre';
    text: string;
    indent?: number;
    ordered?: boolean;
    index?: number;
}

function parseHTMLForPDF(htmlContent: string): PDFElement[] {
    const elements: PDFElement[] = [];
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${htmlContent}</div>`, 'text/html');
    const container = doc.body.firstChild as HTMLElement;

    function processNode(node: Node, listIndent: number = 0, orderedList: boolean = false, listIndex: number = 0): void {
        if (node.nodeType === Node.TEXT_NODE) {
            const text = node.textContent?.trim();
            if (text) {
                // Text node outside of elements - treat as paragraph
                elements.push({ type: 'p', text });
            }
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return;

        const el = node as HTMLElement;
        const tagName = el.tagName.toLowerCase();

        switch (tagName) {
            case 'h1':
                elements.push({ type: 'h1', text: el.textContent || '' });
                break;
            case 'h2':
                elements.push({ type: 'h2', text: el.textContent || '' });
                break;
            case 'h3':
            case 'h4':
            case 'h5':
            case 'h6':
                elements.push({ type: 'h3', text: el.textContent || '' });
                break;
            case 'p':
                elements.push({ type: 'p', text: el.textContent || '' });
                break;
            case 'pre':
                const codeEl = el.querySelector('code');
                elements.push({ type: 'pre', text: codeEl?.textContent || el.textContent || '' });
                break;
            case 'blockquote':
                elements.push({ type: 'blockquote', text: el.textContent || '' });
                break;
            case 'hr':
                elements.push({ type: 'hr', text: '' });
                break;
            case 'ul':
                let ulIndex = 0;
                el.childNodes.forEach(child => {
                    if ((child as HTMLElement).tagName?.toLowerCase() === 'li') {
                        ulIndex++;
                        processNode(child, listIndent + 1, false, ulIndex);
                    }
                });
                break;
            case 'ol':
                let olIndex = 0;
                el.childNodes.forEach(child => {
                    if ((child as HTMLElement).tagName?.toLowerCase() === 'li') {
                        olIndex++;
                        processNode(child, listIndent + 1, true, olIndex);
                    }
                });
                break;
            case 'li':
                elements.push({
                    type: 'li',
                    text: el.textContent || '',
                    indent: listIndent,
                    ordered: orderedList,
                    index: listIndex
                });
                // Check for nested lists
                el.childNodes.forEach(child => {
                    const childTag = (child as HTMLElement).tagName?.toLowerCase();
                    if (childTag === 'ul' || childTag === 'ol') {
                        processNode(child, listIndent, childTag === 'ol', 0);
                    }
                });
                break;
            default:
                // Process children for other elements (div, article, etc.)
                el.childNodes.forEach(child => processNode(child, listIndent, orderedList, listIndex));
        }
    }

    if (container) {
        container.childNodes.forEach(child => processNode(child));
    }

    return elements;
}

// Export to PDF with real selectable text using jsPDF
export async function exportToPDF(
    htmlContent: string,
    fileName: string,
    _theme: Theme,
    _font: FontFamily,
    fontSize: FontSize
): Promise<void> {
    const title = fileName.replace(/\.(md|markdown)$/i, '');

    if (!htmlContent || htmlContent.trim() === '') {
        console.error('No HTML content to export!');
        return;
    }

    // Parse HTML into structured elements
    const elements = parseHTMLForPDF(htmlContent);
    const sizes = pdfFontSizes[fontSize];

    // Create PDF document (A4 size)
    const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 20;
    const maxWidth = pageWidth - margin * 2;
    let y = margin;

    // Helper to add new page if needed
    const checkPageBreak = (height: number) => {
        if (y + height > pageHeight - margin) {
            pdf.addPage();
            y = margin;
            return true;
        }
        return false;
    };

    // Helper to wrap text and return lines
    const wrapText = (text: string, maxW: number, fontSizePt: number): string[] => {
        pdf.setFontSize(fontSizePt);
        return pdf.splitTextToSize(text, maxW);
    };

    // Render each element
    for (const element of elements) {
        switch (element.type) {
            case 'h1': {
                checkPageBreak(15);
                y += 8; // Space before heading
                pdf.setFontSize(sizes.h1);
                pdf.setFont('helvetica', 'bold');
                const lines = wrapText(element.text, maxWidth, sizes.h1);
                pdf.text(lines, margin, y);
                y += lines.length * (sizes.h1 * 0.4) + 3;
                // Draw underline
                pdf.setDrawColor(200, 200, 200);
                pdf.setLineWidth(0.5);
                pdf.line(margin, y, pageWidth - margin, y);
                y += 5;
                break;
            }

            case 'h2': {
                checkPageBreak(12);
                y += 6;
                pdf.setFontSize(sizes.h2);
                pdf.setFont('helvetica', 'bold');
                const lines = wrapText(element.text, maxWidth, sizes.h2);
                pdf.text(lines, margin, y);
                y += lines.length * (sizes.h2 * 0.4) + 2;
                pdf.setDrawColor(220, 220, 220);
                pdf.setLineWidth(0.3);
                pdf.line(margin, y, pageWidth - margin, y);
                y += 4;
                break;
            }

            case 'h3': {
                checkPageBreak(10);
                y += 4;
                pdf.setFontSize(sizes.h3);
                pdf.setFont('helvetica', 'bold');
                const lines = wrapText(element.text, maxWidth, sizes.h3);
                pdf.text(lines, margin, y);
                y += lines.length * (sizes.h3 * 0.4) + 3;
                break;
            }

            case 'p': {
                const lineH = sizes.base * 0.4 * sizes.lineHeight;
                pdf.setFontSize(sizes.base);
                pdf.setFont('helvetica', 'normal');
                const lines = wrapText(element.text, maxWidth, sizes.base);
                checkPageBreak(lines.length * lineH);
                pdf.text(lines, margin, y);
                y += lines.length * lineH + 3;
                break;
            }

            case 'li': {
                const indent = (element.indent || 1) * 5;
                const bullet = element.ordered ? `${element.index}.` : '•';
                const lineH = sizes.base * 0.4 * sizes.lineHeight;
                pdf.setFontSize(sizes.base);
                pdf.setFont('helvetica', 'normal');

                // Clean text - remove bullet/number if already present
                let cleanText = element.text.trim();
                
                const lines = wrapText(cleanText, maxWidth - indent - 5, sizes.base);
                checkPageBreak(lines.length * lineH);

                // Draw bullet/number
                pdf.text(bullet, margin + indent - 4, y);
                // Draw text
                pdf.text(lines, margin + indent + 2, y);
                y += lines.length * lineH + 1;
                break;
            }

            case 'pre': {
                const codeLines = element.text.split('\n');
                const lineH = sizes.code * 0.4;
                const blockHeight = codeLines.length * lineH + 6;
                checkPageBreak(blockHeight);

                // Draw background
                pdf.setFillColor(245, 245, 245);
                pdf.roundedRect(margin, y - 2, maxWidth, blockHeight, 2, 2, 'F');

                pdf.setFontSize(sizes.code);
                pdf.setFont('courier', 'normal');
                pdf.setTextColor(60, 60, 60);

                let codeY = y + 2;
                for (const line of codeLines) {
                    const wrapped = wrapText(line || ' ', maxWidth - 6, sizes.code);
                    pdf.text(wrapped, margin + 3, codeY);
                    codeY += wrapped.length * lineH;
                }

                pdf.setTextColor(0, 0, 0);
                y += blockHeight + 3;
                break;
            }

            case 'blockquote': {
                const lineH = sizes.base * 0.4 * sizes.lineHeight;
                pdf.setFontSize(sizes.base);
                pdf.setFont('helvetica', 'italic');
                const lines = wrapText(element.text, maxWidth - 10, sizes.base);
                const blockHeight = lines.length * lineH + 4;
                checkPageBreak(blockHeight);

                // Draw left border
                pdf.setFillColor(100, 100, 100);
                pdf.rect(margin, y - 2, 2, blockHeight, 'F');

                // Draw background
                pdf.setFillColor(250, 250, 250);
                pdf.rect(margin + 3, y - 2, maxWidth - 3, blockHeight, 'F');

                pdf.setTextColor(80, 80, 80);
                pdf.text(lines, margin + 6, y + 2);
                pdf.setTextColor(0, 0, 0);
                pdf.setFont('helvetica', 'normal');
                y += blockHeight + 3;
                break;
            }

            case 'hr': {
                checkPageBreak(10);
                y += 5;
                pdf.setDrawColor(200, 200, 200);
                pdf.setLineWidth(0.5);
                pdf.line(margin, y, pageWidth - margin, y);
                y += 5;
                break;
            }
        }
    }

    // Add footer
    const pageCount = pdf.getNumberOfPages();
    const date = new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    for (let i = 1; i <= pageCount; i++) {
        pdf.setPage(i);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
        pdf.setTextColor(150, 150, 150);
        pdf.text(`Exported from MarkLite on ${date}`, margin, pageHeight - 10);
        pdf.text(`Page ${i} of ${pageCount}`, pageWidth - margin - 20, pageHeight - 10);
    }

    // Get PDF as array buffer
    const pdfBuffer = pdf.output('arraybuffer');

    // Use Tauri save dialog
    const filePath = await save({
        defaultPath: `${title}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (filePath) {
        // Write binary file
        await writeFile(filePath, new Uint8Array(pdfBuffer));
    }
}
