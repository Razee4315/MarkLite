import { useState, useRef, useEffect } from 'react';
import { useTheme, Theme, FontFamily, FontSize } from '../context/ThemeContext';

const themes: { id: Theme; name: string; colors: [string, string]; textColor: string }[] = [
    { id: 'dark', name: 'Dark', colors: ['#0a0a0a', '#141414'], textColor: '#ffffff' },
    { id: 'light', name: 'Light', colors: ['#ffffff', '#f5f5f5'], textColor: '#171717' },
    { id: 'paper', name: 'Paper', colors: ['#f5f0e6', '#ebe5d8'], textColor: '#3d3d3d' },
];

const fonts: { id: FontFamily; name: string; family: string }[] = [
    { id: 'inter', name: 'Inter', family: "'Inter', sans-serif" },
    { id: 'merriweather', name: 'Merriweather', family: "'Merriweather', serif" },
    { id: 'lora', name: 'Lora', family: "'Lora', serif" },
    { id: 'source-serif', name: 'Source Serif', family: "'Source Serif 4', serif" },
    { id: 'fira-sans', name: 'Fira Sans', family: "'Fira Sans', sans-serif" },
];

const fontSizes: { id: FontSize; name: string; size: string }[] = [
    { id: 'small', name: 'Small', size: '14px' },
    { id: 'medium', name: 'Medium', size: '16px' },
    { id: 'large', name: 'Large', size: '18px' },
];

export function SettingsMenu() {
    const [isOpen, setIsOpen] = useState(false);
    const { theme, setTheme, font, setFont, fontSize, setFontSize } = useTheme();
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

    return (
        <div ref={menuRef} className="relative no-drag">
            {/* Settings Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="btn-press flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title="Settings"
            >
                <span className="material-symbols-outlined text-[18px]">settings</span>
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-72 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in-down">
                    {/* Theme Section */}
                    <div className="p-4 border-b border-[var(--border)]">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                            Theme
                        </div>
                        <div className="flex gap-2">
                            {themes.map((t) => (
                                <button
                                    key={t.id}
                                    onClick={() => setTheme(t.id)}
                                    className={`flex-1 flex flex-col items-center gap-2 p-3 rounded-lg transition-all ${theme === t.id
                                        ? 'ring-2 ring-[var(--accent)] bg-[var(--bg-hover)]'
                                        : 'hover:bg-[var(--bg-hover)]'
                                        }`}
                                    title={t.name}
                                >
                                    {/* Theme Preview */}
                                    <div
                                        className="w-10 h-10 rounded-lg overflow-hidden border border-[var(--border)] flex shadow-sm"
                                        style={{ backgroundColor: t.colors[0] }}
                                    >
                                        <div className="w-1/2 h-full" style={{ backgroundColor: t.colors[0] }}></div>
                                        <div className="w-1/2 h-full" style={{ backgroundColor: t.colors[1] }}></div>
                                    </div>
                                    <span
                                        className="text-[11px] font-medium"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        {t.name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Font Section */}
                    <div className="p-4 border-b border-[var(--border)]">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                            Font
                        </div>
                        <div className="flex flex-col gap-1">
                            {fonts.map((f) => (
                                <button
                                    key={f.id}
                                    onClick={() => setFont(f.id)}
                                    className={`w-full text-left px-3 py-2 rounded-lg transition-all text-sm ${font === f.id
                                        ? 'bg-[var(--accent)] text-[var(--accent-text)] font-medium'
                                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                                        }`}
                                    style={{ fontFamily: f.family }}
                                >
                                    {f.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Font Size Section */}
                    <div className="p-4">
                        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                            Font Size
                        </div>
                        <div className="flex gap-2">
                            {fontSizes.map((s) => (
                                <button
                                    key={s.id}
                                    onClick={() => setFontSize(s.id)}
                                    className={`flex-1 px-3 py-2 rounded-lg transition-all text-sm text-center ${fontSize === s.id
                                        ? 'bg-[var(--accent)] text-[var(--accent-text)] font-medium'
                                        : 'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                                        }`}
                                >
                                    {s.name}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
