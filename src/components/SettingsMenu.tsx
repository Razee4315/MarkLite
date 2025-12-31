import { useState, useRef, useEffect } from 'react';
import { useTheme, Theme, FontFamily } from '../context/ThemeContext';

const themes: { id: Theme; name: string; colors: [string, string, string] }[] = [
    { id: 'dark', name: 'Dark', colors: ['#21222c', '#282a36', '#bd93f9'] },
    { id: 'light', name: 'Light', colors: ['#ffffff', '#f8f9fa', '#6366f1'] },
    { id: 'paper', name: 'Paper', colors: ['#f5f0e6', '#ebe5d8', '#8b7355'] },
];

const fonts: { id: FontFamily; name: string; family: string }[] = [
    { id: 'inter', name: 'Inter', family: "'Inter', sans-serif" },
    { id: 'merriweather', name: 'Merriweather', family: "'Merriweather', serif" },
    { id: 'lora', name: 'Lora', family: "'Lora', serif" },
    { id: 'source-serif', name: 'Source Serif', family: "'Source Serif 4', serif" },
    { id: 'fira-sans', name: 'Fira Sans', family: "'Fira Sans', sans-serif" },
];

export function SettingsMenu() {
    const [isOpen, setIsOpen] = useState(false);
    const { theme, setTheme, font, setFont } = useTheme();
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
                className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                title="Settings"
            >
                <span className="material-symbols-outlined text-[18px]">settings</span>
            </button>

            {/* Dropdown Menu */}
            {isOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden z-50">
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
                                            ? 'bg-[var(--accent)] bg-opacity-20 ring-2 ring-[var(--accent)]'
                                            : 'hover:bg-[var(--bg-hover)]'
                                        }`}
                                    title={t.name}
                                >
                                    {/* Theme Preview */}
                                    <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-[var(--border)] flex">
                                        <div className="w-1/2" style={{ backgroundColor: t.colors[0] }}></div>
                                        <div className="w-1/2" style={{ backgroundColor: t.colors[1] }}></div>
                                    </div>
                                    <span className="text-[10px] font-medium text-[var(--text-secondary)]">
                                        {t.name}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Font Section */}
                    <div className="p-4">
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
                </div>
            )}
        </div>
    );
}
