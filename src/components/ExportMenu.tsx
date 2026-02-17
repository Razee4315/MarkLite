import { useState, useRef, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { exportToHTML, exportToPDF } from '../utils/exportUtils';

interface ExportMenuProps {
    fileName: string;
    getExportHtml?: () => string;
}

type ExportFormat = 'html' | 'pdf';

export function ExportMenu({ fileName, getExportHtml }: ExportMenuProps) {
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
            if (format === 'html') {
                await exportToHTML(htmlContent, fileName, theme, font, fontSize);
            } else {
                await exportToPDF(htmlContent, fileName, theme, font, fontSize);
            }
        } catch (error) {
            console.error(`Failed to export ${format}:`, error);
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
                className={`btn-press flex items-center gap-1 px-2 py-1 rounded hover:bg-[var(--bg-hover)] transition-colors text-xs ${
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
                <div className="absolute left-0 top-full mt-1 w-40 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-xl overflow-hidden z-50 animate-fade-in-down">
                    <button
                        onClick={() => handleExport('html')}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-hover)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">code</span>
                        <span>HTML</span>
                    </button>
                    <button
                        onClick={() => handleExport('pdf')}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-[var(--bg-hover)] transition-colors"
                    >
                        <span className="material-symbols-outlined text-[18px]">picture_as_pdf</span>
                        <span>PDF</span>
                    </button>
                </div>
            )}
        </div>
    );
}
