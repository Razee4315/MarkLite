import { describe, it, expect } from "vitest";
import { AI_PROVIDERS, matchProvider } from "./aiProviders";

describe("matchProvider", () => {
    it("matches every preset by its own endpoint", () => {
        for (const p of AI_PROVIDERS) {
            expect(matchProvider(p.endpoint)?.id).toBe(p.id);
        }
    });

    it("tolerates surrounding whitespace and trailing slashes", () => {
        expect(matchProvider("  https://api.openai.com/v1/chat/completions/ ")?.id).toBe("openai");
    });

    it("returns null for empty and hand-configured endpoints", () => {
        expect(matchProvider("")).toBeNull();
        expect(matchProvider("   ")).toBeNull();
        expect(matchProvider("https://my-proxy.example.com/v1/chat/completions")).toBeNull();
    });

    it("every preset endpoint is a valid https/http URL", () => {
        for (const p of AI_PROVIDERS) {
            const u = new URL(p.endpoint);
            expect(["http:", "https:"]).toContain(u.protocol);
        }
    });
});
