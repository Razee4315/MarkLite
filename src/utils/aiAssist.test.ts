import { describe, it, expect, vi, afterEach } from "vitest";
import { isValidEndpoint, runAIAction, type AIConfig } from "./aiAssist";

const cfg = (over: Partial<AIConfig> = {}): AIConfig => ({
    endpoint: "https://api.test/v1/chat/completions",
    model: "test-model",
    apiKey: "k",
    ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("isValidEndpoint", () => {
    it("accepts http and https", () => {
        expect(isValidEndpoint("http://localhost:11434/v1/chat/completions")).toBe(true);
        expect(isValidEndpoint("https://api.openai.com/v1/chat/completions")).toBe(true);
    });
    it("rejects other schemes and garbage", () => {
        expect(isValidEndpoint("ftp://x")).toBe(false);
        expect(isValidEndpoint("not a url")).toBe(false);
        expect(isValidEndpoint("")).toBe(false);
    });
});

describe("runAIAction config guards", () => {
    it("throws when endpoint missing", async () => {
        await expect(runAIAction("rewrite", "hi", cfg({ endpoint: "" }))).rejects.toThrow(/endpoint not configured/i);
    });
    it("throws for an invalid endpoint URL", async () => {
        await expect(runAIAction("rewrite", "hi", cfg({ endpoint: "nope" }))).rejects.toThrow(/valid http/i);
    });
    it("throws when model missing", async () => {
        await expect(runAIAction("rewrite", "hi", cfg({ model: "" }))).rejects.toThrow(/model not configured/i);
    });
});

describe("runAIAction request handling", () => {
    it("returns the OpenAI-style content on success", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ choices: [{ message: { content: "  hello  " } }] }),
        }));
        await expect(runAIAction("rewrite", "x", cfg())).resolves.toBe("hello");
    });

    it("supports the Ollama native shape", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ message: { content: "ollama out" } }),
        }));
        await expect(runAIAction("continue", "x", cfg())).resolves.toBe("ollama out");
    });

    it("maps a 401 to an actionable message", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: false,
            status: 401,
            text: () => Promise.resolve("unauthorized"),
        }));
        await expect(runAIAction("rewrite", "x", cfg())).rejects.toThrow(/api key invalid or unauthorized/i);
    });

    it("throws on an empty response", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ choices: [{ message: { content: "" } }] }),
        }));
        await expect(runAIAction("rewrite", "x", cfg())).rejects.toThrow(/empty response/i);
    });
});
