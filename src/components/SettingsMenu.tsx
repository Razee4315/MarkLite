import { useEffect, useRef, useState } from "react";
import { FONT_SIZE_MAX, FONT_SIZE_MIN, FONT_SIZE_STEP } from "../config/ui";
import { FontFamily, Theme, useTheme } from "../context/ThemeContext";

const themes: {
   id: Theme;
   name: string;
   colors: [string, string];
   textColor: string;
   icon?: string;
}[] = [
   {
      id: "dark",
      name: "Dark",
      colors: ["#0a0a0a", "#141414"],
      textColor: "#ffffff",
   },
   {
      id: "light",
      name: "Light",
      colors: ["#ffffff", "#f5f5f5"],
      textColor: "#171717",
   },
   {
      id: "paper",
      name: "Paper",
      colors: ["#f5f0e6", "#ebe5d8"],
      textColor: "#3d3d3d",
   },
   {
      id: "github",
      name: "GitHub",
      colors: ["#0d1117", "#161b22"],
      textColor: "#ffffff",
      icon: "github",
   },
];

const fonts: { id: FontFamily; name: string; family: string }[] = [
   { id: "inter", name: "Inter", family: "'Inter', sans-serif" },
   {
      id: "merriweather",
      name: "Merriweather",
      family: "'Merriweather', serif",
   },
   { id: "lora", name: "Lora", family: "'Lora', serif" },
   {
      id: "source-serif",
      name: "Source Serif",
      family: "'Source Serif 4', serif",
   },
   { id: "fira-sans", name: "Fira Sans", family: "'Fira Sans', sans-serif" },
];

function clamp(num: number, min: number, max: number): number {
   return Math.min(max, Math.max(min, num));
}

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
         document.addEventListener("mousedown", handleClickOutside);
      }

      return () =>
         document.removeEventListener("mousedown", handleClickOutside);
   }, [isOpen]);

   return (
      <div ref={menuRef} className="relative no-drag">
         {/* Settings Button */}
         <button
            onClick={() => setIsOpen(!isOpen)}
            className="btn-press flex items-center justify-center w-8 h-8 rounded-lg hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            title="Settings"
         >
            <span className="material-symbols-outlined text-[18px]">
               settings
            </span>
         </button>

         {/* Dropdown Menu */}
         {isOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl shadow-2xl overflow-hidden z-50 animate-fade-in-down">
               {/* Theme Section */}
               <div className="p-4 border-b border-[var(--border)]">
                  <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
                     Theme
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                     {themes.map((t) => (
                        <button
                           key={t.id}
                           onClick={() => setTheme(t.id)}
                           className={`flex-1 flex flex-col items-center gap-2 p-3 rounded-lg transition-all ${
                              theme === t.id
                                 ? "ring-2 ring-[var(--accent)] bg-[var(--bg-hover)]"
                                 : "hover:bg-[var(--bg-hover)]"
                           }`}
                           title={t.name}
                        >
                           {/* Theme Preview */}
                           <div
                              className="w-10 h-10 rounded-lg overflow-hidden border border-[var(--border)] flex items-center justify-center shadow-sm"
                              style={{ backgroundColor: t.colors[0] }}
                           >
                              {t.icon === "github" ? (
                                 <svg
                                    className="w-6 h-6"
                                    fill={t.textColor}
                                    viewBox="0 0 24 24"
                                 >
                                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                                 </svg>
                              ) : (
                                 <>
                                    <div
                                       className="w-1/2 h-full"
                                       style={{ backgroundColor: t.colors[0] }}
                                    ></div>
                                    <div
                                       className="w-1/2 h-full"
                                       style={{ backgroundColor: t.colors[1] }}
                                    ></div>
                                 </>
                              )}
                           </div>
                           <span
                              className="text-[11px] font-medium"
                              style={{ color: "var(--text-primary)" }}
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
                           className={`w-full text-left px-3 py-2 rounded-lg transition-all text-sm ${
                              font === f.id
                                 ? "bg-[var(--accent)] text-[var(--accent-text)] font-medium"
                                 : "text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
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
                  <div className="text-xs font-semibold text-(--text-secondary) uppercase tracking-wider mb-3">
                     Font Size
                  </div>
                  <div className="bg-(--bg-input)">
                     <div className="flex items-center justify-between mb-1">
                        <div className="text-[11px] text-(--text-secondary)">
                           Adjust
                        </div>
                        <div className="text-[11px] font-semibold text-(--text-primary) tabular-nums">
                           {clamp(fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX)}px
                        </div>
                     </div>

                     <div className="flex items-center gap-3">
                        <span className="select-none text-[12px] text-(--text-secondary)">
                           A
                        </span>
                        <input
                           type="range"
                           min={FONT_SIZE_MIN}
                           max={FONT_SIZE_MAX}
                           step={FONT_SIZE_STEP}
                           value={clamp(fontSize, FONT_SIZE_MIN, FONT_SIZE_MAX)}
                           onChange={(e) => setFontSize(Number(e.target.value))}
                           className="ruler-range w-full"
                           style={{
                              background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${
                                 ((clamp(
                                    fontSize,
                                    FONT_SIZE_MIN,
                                    FONT_SIZE_MAX
                                 ) -
                                    FONT_SIZE_MIN) /
                                    (FONT_SIZE_MAX - FONT_SIZE_MIN)) *
                                 100
                              }%, var(--border) ${
                                 ((clamp(
                                    fontSize,
                                    FONT_SIZE_MIN,
                                    FONT_SIZE_MAX
                                 ) -
                                    FONT_SIZE_MIN) /
                                    (FONT_SIZE_MAX - FONT_SIZE_MIN)) *
                                 100
                              }%, var(--border) 100%)`,
                           }}
                           aria-label="Font size"
                        />
                        <span className="select-none text-[16px] font-semibold text-(--text-secondary)">
                           A
                        </span>
                     </div>

                     {/* Ruler ticks */}
                     <div className="mt-1 flex items-end justify-between">
                        {Array.from(
                           { length: FONT_SIZE_MAX - FONT_SIZE_MIN + 1 },
                           (_, i) => FONT_SIZE_MIN + i
                        ).map((v) => {
                           const isMajor = v % 4 === 0;
                           const isMid = v % 2 === 0;
                           return (
                              <div
                                 key={v}
                                 className="flex flex-col items-center flex-1 text-[10px]"
                              >
                                 <div
                                    className="w-px bg-[var(--border)] text-[10px]"
                                    style={{
                                       height: isMajor ? 10 : isMid ? 7 : 5,
                                    }}
                                 />
                                 <div className="h-3 mt-1">
                                    {isMajor ? (
                                       <span className="text-[10px] text-[var(--text-secondary)] tabular-nums">
                                          {v}
                                       </span>
                                    ) : null}
                                 </div>
                              </div>
                           );
                        })}
                     </div>
                  </div>
               </div>
            </div>
         )}
      </div>
   );
}
