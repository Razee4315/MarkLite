import { describe, it, expect } from "vitest";
import { computeStats } from "./documentStats";

describe("computeStats", () => {
    it("returns zeros for an empty document", () => {
        const s = computeStats("");
        expect(s.words).toBe(0);
        expect(s.lines).toBe(0);
        expect(s.readingTimeMin).toBe(0);
    });

    it("counts structural elements and excludes code from word count", () => {
        const src = [
            "---",
            "a: 1",
            "---",
            "# Title",
            "",
            "Hello world.",
            "",
            "```js",
            "const ignoredCodeWords = 1;",
            "```",
            "",
            "[link](http://x) and ![img](y.png)",
        ].join("\n");
        const s = computeStats(src);
        expect(s.headings).toBe(1);
        expect(s.links).toBe(1);
        expect(s.images).toBe(1);
        expect(s.codeBlocks).toBe(1);
        // "ignoredCodeWords" lives in a fenced block and must not be counted.
        expect(s.words).toBeGreaterThan(0);
        expect(s.words).toBeLessThan(12);
    });
});
