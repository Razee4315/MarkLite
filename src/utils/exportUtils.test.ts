import { describe, it, expect, vi, type Mock } from "vitest";

// exportUtils imports Tauri plugins at module load; stub them so the pure
// HTML-generation helpers can be tested without a Tauri runtime. The functions
// under test (generateHTML, prepareExportHtml) never call these.
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: vi.fn(), writeFile: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { exportToDocx, generateHTML, prepareExportHtml } from "./exportUtils";

describe("generateHTML", () => {
    it("wraps the content in a standalone HTML document", () => {
        const out = generateHTML("<p>Hello</p>", "My Doc", "dark", "inter", "medium");
        expect(out).toContain("<!DOCTYPE html>");
        expect(out).toContain("<title>My Doc</title>");
        expect(out).toContain("<p>Hello</p>");
        expect(out).toContain("<article>");
    });

    it("escapes HTML-special characters in the title (XSS-safe)", () => {
        const out = generateHTML("<p>x</p>", '<script>alert(1)</script>&"', "dark", "inter", "medium");
        expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;&amp;&quot;");
        expect(out).not.toContain("<title><script>");
    });

    it("includes the export footer by default and omits it when disabled", () => {
        expect(generateHTML("<p>x</p>", "t", "dark", "inter", "medium")).toContain("Exported from Paperling");
        expect(generateHTML("<p>x</p>", "t", "dark", "inter", "medium", false)).not.toContain("Exported from Paperling");
    });

    it("applies theme-specific colors", () => {
        expect(generateHTML("<p>x</p>", "t", "dark", "inter", "medium")).toContain("#0a0a0a");
        expect(generateHTML("<p>x</p>", "t", "paper", "inter", "medium")).toContain("#f5f0e6");
    });

    it("applies the selected font family and size", () => {
        const out = generateHTML("<p>x</p>", "t", "dark", "inter", "large");
        expect(out).toContain("'Inter'");
        expect(out).toContain("18px"); // large base size
    });
});

describe("prepareExportHtml", () => {
    it("strips leaked UI chrome (buttons and icon ligatures)", async () => {
        const html = '<p>Body</p><button>Copy</button><span class="material-symbols-outlined">link</span>';
        const out = await prepareExportHtml(html);
        expect(out).toContain("<p>Body</p>");
        expect(out).not.toContain("<button");
        expect(out).not.toContain("material-symbols-outlined");
    });

    it("neutralizes app-internal wikilink anchors into plain text", async () => {
        const out = await prepareExportHtml('<a href="wikilink:Foo">Foo</a>');
        expect(out).toContain("Foo");
        expect(out).not.toContain("wikilink:");
        expect(out).not.toContain("<a");
    });

    it("leaves ordinary links and non-blob images intact", async () => {
        const html = '<a href="https://example.com">site</a><img src="data:image/png;base64,AAAA">';
        const out = await prepareExportHtml(html);
        expect(out).toContain('href="https://example.com"');
        expect(out).toContain('src="data:image/png;base64,AAAA"');
    });
});

describe("exportToDocx", () => {
    it("returns false and writes nothing when the save dialog is cancelled", async () => {
        (save as Mock).mockResolvedValueOnce(null);
        (writeFile as Mock).mockClear();
        const ok = await exportToDocx("<h1>Hi</h1>", "doc.md", "dark", "inter", "medium");
        expect(ok).toBe(false);
        expect(writeFile).not.toHaveBeenCalled();
    });

    it("converts the HTML and writes a valid OOXML .docx to the chosen path", async () => {
        (save as Mock).mockResolvedValueOnce("C:/tmp/out.docx");
        (writeFile as Mock).mockClear();
        const ok = await exportToDocx(
            "<h1>Title</h1><p>Hello <strong>world</strong></p><ul><li>a</li><li>b</li></ul>",
            "doc.md",
            "dark", "inter", "medium"
        );
        expect(ok).toBe(true);
        expect(writeFile).toHaveBeenCalledOnce();
        const [path, bytes] = (writeFile as Mock).mock.calls[0];
        expect(path).toBe("C:/tmp/out.docx");
        expect(bytes).toBeInstanceOf(Uint8Array);
        // A .docx is a ZIP archive — it must start with the local-file-header
        // magic bytes "PK\x03\x04". This proves we wrote a real Office document,
        // not an HTML blob with a .docx extension.
        expect(Array.from(bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    }, 20000);
});
