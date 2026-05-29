import { describe, it, expect } from "vitest";
import { buildAskMessages } from "./aiChat";

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
