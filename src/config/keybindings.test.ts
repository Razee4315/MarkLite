import { describe, it, expect, beforeEach, vi } from "vitest";

// isMac/isWindows are evaluated once at module load from navigator.platform, so
// each platform case stubs the platform and re-imports the module fresh.
function setPlatform(platform: string) {
    Object.defineProperty(globalThis.navigator, "platform", { value: platform, configurable: true });
}

async function loadFresh() {
    vi.resetModules();
    return await import("./keybindings");
}

const kev = (init: KeyboardEventInit) => new KeyboardEvent("keydown", init);

describe("keybindings on macOS", () => {
    beforeEach(() => setPlatform("MacIntel"));

    it("resolves the primary modifier to Cmd (meta), not Ctrl", async () => {
        const kb = await loadFresh();
        expect(kb.isMac).toBe(true);
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true }), "save")).toBe(true);
        // The core bug this fixes: Ctrl+S must NOT save on macOS.
        expect(kb.matchesBinding(kev({ key: "s", ctrlKey: true }), "save")).toBe(false);
    });

    it("keeps tab cycling on a literal Ctrl (⌘Tab is the OS app-switcher)", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "Tab", ctrlKey: true }), "nextTab")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "Tab", metaKey: true }), "nextTab")).toBe(false);
    });

    it("distinguishes shifted from unshifted combos", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true, shiftKey: true }), "saveAs")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true, shiftKey: true }), "save")).toBe(false);
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true }), "saveAs")).toBe(false);
    });

    it("matches keys case-insensitively (CapsLock)", async () => {
        const kb = await loadFresh();
        expect(kb.matchesBinding(kev({ key: "S", metaKey: true }), "save")).toBe(true);
    });

    it("formats shortcuts with macOS glyphs in ⌃⌥⇧⌘ order", async () => {
        const kb = await loadFresh();
        expect(kb.formatShortcut("save")).toBe("⌘S");
        expect(kb.formatShortcut("saveAs")).toBe("⇧⌘S");
        expect(kb.formatShortcut("nextTab")).toBe("⌃Tab");
        expect(kb.formatShortcut("settings")).toBe("⌘,");
        expect(kb.formatShortcut("fullscreen")).toBe("F11");
    });

    it("produces CodeMirror Mod- keys for editor bindings", async () => {
        const kb = await loadFresh();
        expect(kb.toCmKey("bold")).toBe("Mod-b");
        expect(kb.toCmKey("find")).toBe("Mod-f");
        expect(kb.toCmKey("blockquote")).toBe("Mod-/");
    });
});

describe("keybindings on Windows/Linux", () => {
    beforeEach(() => setPlatform("Win32"));

    it("resolves the primary modifier to Ctrl", async () => {
        const kb = await loadFresh();
        expect(kb.isMac).toBe(false);
        expect(kb.matchesBinding(kev({ key: "s", ctrlKey: true }), "save")).toBe(true);
        expect(kb.matchesBinding(kev({ key: "s", metaKey: true }), "save")).toBe(false);
    });

    it("formats shortcuts as Ctrl+…", async () => {
        const kb = await loadFresh();
        expect(kb.formatShortcut("saveAs")).toBe("Ctrl+Shift+S");
        expect(kb.formatShortcut("nextTab")).toBe("Ctrl+Tab");
        expect(kb.formatShortcut("settings")).toBe("Ctrl+,");
    });
});
