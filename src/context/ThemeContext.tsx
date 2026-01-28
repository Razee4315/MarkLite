import {
   createContext,
   ReactNode,
   useContext,
   useEffect,
   useState,
} from "react";
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from "../config/ui";

export type Theme = "dark" | "light" | "paper" | "github";
export type FontFamily =
   | "inter"
   | "merriweather"
   | "lora"
   | "source-serif"
   | "fira-sans";
// Stored and applied as a pixel value (e.g. 16)
export type FontSize = number;

interface ThemeContextType {
   theme: Theme;
   setTheme: (theme: Theme) => void;
   font: FontFamily;
   setFont: (font: FontFamily) => void;
   fontSize: FontSize;
   setFontSize: (size: FontSize) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

const THEME_STORAGE_KEY = "marklite-theme";
const FONT_STORAGE_KEY = "marklite-font";
const FONT_SIZE_STORAGE_KEY = "marklite-font-size";

const FONT_SIZE_DEFAULT = 16;

function clamp(num: number, min: number, max: number): number {
   return Math.min(max, Math.max(min, num));
}

function parseStoredFontSize(stored: string | null): number {
   if (!stored) return FONT_SIZE_DEFAULT;

   // Backward compatibility (older versions stored "small|medium|large")
   if (stored === "small") return 14;
   if (stored === "medium") return 16;
   if (stored === "large") return 18;

   const parsed = Number(stored);
   if (!Number.isFinite(parsed)) return FONT_SIZE_DEFAULT;
   return clamp(Math.round(parsed), FONT_SIZE_MIN, FONT_SIZE_MAX);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
   const [theme, setThemeState] = useState<Theme>(() => {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      return (stored as Theme) || "dark";
   });

   const [font, setFontState] = useState<FontFamily>(() => {
      const stored = localStorage.getItem(FONT_STORAGE_KEY);
      return (stored as FontFamily) || "inter";
   });

   const [fontSize, setFontSizeState] = useState<FontSize>(() => {
      return parseStoredFontSize(localStorage.getItem(FONT_SIZE_STORAGE_KEY));
   });

   const setTheme = (newTheme: Theme) => {
      setThemeState(newTheme);
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
   };

   const setFont = (newFont: FontFamily) => {
      setFontState(newFont);
      localStorage.setItem(FONT_STORAGE_KEY, newFont);
   };

   const setFontSize = (newSize: FontSize) => {
      const normalized = clamp(
         Math.round(newSize),
         FONT_SIZE_MIN,
         FONT_SIZE_MAX
      );
      setFontSizeState(normalized);
      localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(normalized));
   };

   // Apply theme to document
   useEffect(() => {
      document.documentElement.setAttribute("data-theme", theme);
   }, [theme]);

   // Apply font to document
   useEffect(() => {
      document.documentElement.setAttribute("data-font", font);
   }, [font]);

   // Apply font size to document
   useEffect(() => {
      const root = document.documentElement;

      const sizePx = clamp(Math.round(fontSize), FONT_SIZE_MIN, FONT_SIZE_MAX);
      // Match prior feel: 14px -> 1.6, 16px -> 1.7, 18px -> 1.8 (clamped)
      const lineHeight = clamp(0.7 + sizePx * 0.05, 1.55, 1.85);

      root.style.setProperty("--font-size-base", `${sizePx}px`);
      root.style.setProperty("--line-height", `${lineHeight.toFixed(2)}`);
   }, [fontSize]);

   return (
      <ThemeContext.Provider
         value={{ theme, setTheme, font, setFont, fontSize, setFontSize }}
      >
         {children}
      </ThemeContext.Provider>
   );
}

export function useTheme() {
   const context = useContext(ThemeContext);
   if (!context) {
      throw new Error("useTheme must be used within a ThemeProvider");
   }
   return context;
}
