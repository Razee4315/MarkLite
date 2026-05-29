import { describe, it, expect } from "vitest";
import { buildAskMessages, parseEdits } from "./aiChat";

describe("parseEdits", () => {
    const block = (s: string, r: string) => `<<<<<<< SEARCH\n${s}\n=======\n${r}\n>>>>>>> REPLACE`;

    it("applies a single SEARCH/REPLACE block", () => {
        const doc = "# Title\n\nHello world.\n";
        const res = parseEdits(block("Hello world.", "Hello, brave new world!"), doc);
        expect(res.hasEdits).toBe(true);
        expect(res.applied).toBe(1);
        expect(res.failed).toBe(0);
        expect(res.proposedDoc).toBe("# Title\n\nHello, brave new world!\n");
    });

    it("applies multiple blocks in order", () => {
        const doc = "alpha\nbravo\ncharlie\n";
        const resp = block("alpha", "ALPHA") + "\n" + block("charlie", "CHARLIE");
        const res = parseEdits(resp, doc);
        expect(res.applied).toBe(2);
        expect(res.proposedDoc).toBe("ALPHA\nbravo\nCHARLIE\n");
    });

    it("counts a non-matching block as failed and leaves it out", () => {
        const doc = "one two three";
        const res = parseEdits(block("nonexistent", "x"), doc);
        expect(res.applied).toBe(0);
        expect(res.failed).toBe(1);
        expect(res.proposedDoc).toBe(doc);
    });

    it("treats a plain answer (no blocks) as not-an-edit", () => {
        const res = parseEdits("This document is about robots.", "anything");
        expect(res.hasEdits).toBe(false);
        expect(res.explanation).toContain("robots");
    });

    it("separates the summary sentence from the blocks", () => {
        const resp = "Tightened the intro.\n" + block("old", "new");
        const res = parseEdits(resp, "old text");
        expect(res.applied).toBe(1);
        expect(res.explanation).toBe("Tightened the intro.");
    });

    it("rewrites the whole document when SEARCH is the entire doc", () => {
        const doc = "completely\nold\ncontent";
        const res = parseEdits(block(doc, "brand new content"), doc);
        expect(res.proposedDoc).toBe("brand new content");
    });
});

describe("buildAskMessages", () => {
    it("puts the system prompt first and the document only in the latest turn", () => {
        const history = [
            { role: "user" as const, content: "hi" },
            { role: "assistant" as const, content: "hello" },
        ];
        const msgs = buildAskMessages(history, "# My Note\nbody", "", "summarize it");

        expect(msgs[0].role).toBe("system");
        // History is carried through verbatim and stays document-free (token efficiency).
        expect(msgs.some((m) => m.content === "hi")).toBe(true);
        expect(history.every((h) => !h.content.includes("My Note"))).toBe(true);

        const last = msgs[msgs.length - 1];
        expect(last.role).toBe("user");
        expect(last.content).toContain("# My Note");
        expect(last.content).toContain("summarize it");
    });

    it("includes the selected passage when present", () => {
        const msgs = buildAskMessages([], "full document text", "the selected bit", "what is this");
        const last = msgs[msgs.length - 1];
        expect(last.content).toContain("the selected bit");
        expect(last.content.toLowerCase()).toContain("selected");
    });
});
