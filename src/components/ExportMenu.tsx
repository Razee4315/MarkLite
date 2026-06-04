import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import iconExportPdf from '../assets/mascot/icon-export-pdf.png';
import iconPaperPlane from '../assets/mascot/icon-paper-plane.png';

// Heavy export deps (jsPDF pulls in ~200 kB of html2canvas; jsPDF itself is
// another big bundle) only matter when the user actually exports. We import
// the module on demand so the main chunk doesn't ship them. Caching the
// promise means a second click — or HTML-then-PDF — reuses the first load.
type ExportModule = typeof import('../utils/exportUtils');
let exportModulePromise: Promise<ExportModule> | null = null;
const loadExportModule = (): Promise<ExportModule> => {
    if (!exportModulePromise) {
        exportModulePromise = import('../utils/exportUtils');
    }
    return exportModulePromise;
};

interface ExportMenuProps {
    fileName: string;
    getExportHtml?: () => string;
    onSuccess?: (format: string) => void;
    onError?: (format: string) => void;
}

type ExportFormat = 'html' | 'pdf';

export function ExportMenu({ fileName, getExportHtml, onSuccess, onError }: ExportMenuProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const { theme, font, fontSize } = useTheme();
    const menuRef = useRef<HTMLDivElement>(null);

    // Close menu when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    const disabled = !getExportHtml;

    const handleExport = async (format: ExportFormat) => {
        if (isExporting || !getExportHtml) return;

        // Capture HTML on demand from the visible preview
        const htmlContent = getExportHtml();
        if (!htmlContent) return;

        setIsExporting(true);
        setIsOpen(false);

        try {
            const mod = await loadExportModule();
            if (format === 'html') {
                await mod.exportToHTML(htmlContent, fileName, theme, font, fontSize);
            } else {
                await mod.exportToPDF(htmlContent, fileName, theme, font, fontSize);
            }
            onSuccess?.(format.toUpperCase());
        } catch (error) {
            console.error(`Failed to export ${format}:`, error);
            onError?.(format.toUpperCase());
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div ref={menuRef} className="relative no-drag">
            {/* Export Button */}
            <button
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled || isExporting}
                aria-label="Export document"
                aria-expanded={isOpen}
                aria-haspopup="true"
                className={`btn-press flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)] transition-colors text-xs ${
                    disabled
                        ? 'opacity-40 cursor-not-allowed text-[var(--text-muted)]'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
                title="Export document"
            >
                {isExporting ? (
                    <>
                        <span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>
                        <span>Exporting...</span>
                    </>
                ) : (
                    <>
                        <span className="material-symbols-outlined text-[16px]">download</span>
                        <span>Export</span>
                    </>
                )}
            </button>

            {/* Simple Dropdown Menu */}
            {isOpen && !disabled && (
                <div role="menu" aria-label="Export formats" className="absolute left-0 top-full mt-1 w-40 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden z-50 animate-fade-in-down">
                    <button
                        role="menuitem"
                        onClick={() => handleExport('html')}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--bg-hover)] transition-colors"
                    >
                        <img src={iconPaperPlane} alt="" aria-hidden="true" draggable={false} className="w-6 h-6 object-contain select-none" />
                        <span>HTML</span>
                    </button>
                    <button
                        role="menuitem"
                        onClick={() => handleExport('pdf')}
                        className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left hover:bg-[var(--bg-hover)] transition-colors"
                    >
                        <img src={iconExportPdf} alt="" aria-hidden="true" draggable={false} className="w-6 h-6 object-contain select-none" />
                        <span>PDF</span>
                    </button>
                </div>
            )}
        </div>
    );
}
