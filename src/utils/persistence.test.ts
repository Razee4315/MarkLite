import { describe, it, expect, beforeEach } from "vitest";
import {
    getRecentFiles, addRecentFile, removeRecentFile, clearRecentFiles,
    getSplitRatio, setSplitRatio,
    getAIConfig, setAIConfig,
    getWordWrap,
} from "./persistence";

beforeEach(() => localStorage.clear());

describe("recent files", () => {
    it("adds most-recent first and de-duplicates by path", () => {
        addRecentFile("/a.md", "a");
        addRecentFile("/b.md", "b");
        addRecentFile("/a.md", "a"); // re-open a -> moves to front
        const list = getRecentFiles();
        expect(list.map((f) => f.path)).toEqual(["/a.md", "/b.md"]);
    });

    it("caps the list at 10 entries", () => {
        for (let i = 0; i < 15; i++) addRecentFile(`/f${i}.md`, `f${i}`);
        expect(getRecentFiles()).toHaveLength(10);
    });

    it("removes and clears", () => {
        addRecentFile("/a.md", "a");
        addRecentFile("/b.md", "b");
        removeRecentFile("/a.md");
        expect(getRecentFiles().map((f) => f.path)).toEqual(["/b.md"]);
        clearRecentFiles();
        expect(getRecentFiles()).toEqual([]);
    });
});

describe("split ratio", () => {
    it("defaults to 0.5", () => {
        expect(getSplitRatio()).toBe(0.5);
    });
    it("persists a valid value and rejects out-of-range", () => {
        setSplitRatio(0.3);
        expect(getSplitRatio()).toBe(0.3);
        setSplitRatio(0.99); // out of (0.15, 0.85) -> falls back to 0.5
        expect(getSplitRatio()).toBe(0.5);
    });
});

describe("AI config", () => {
    it("round-trips endpoint/model/key", () => {
        setAIConfig({ endpoint: "https://x/v1/chat/completions", model: "m", apiKey: "k" });
        expect(getAIConfig()).toEqual({ endpoint: "https://x/v1/chat/completions", model: "m", apiKey: "k" });
    });
    it("returns empty strings when unset", () => {
        expect(getAIConfig()).toEqual({ endpoint: "", model: "", apiKey: "" });
    });
});

describe("defaults", () => {
    it("word wrap defaults to true", () => {
        expect(getWordWrap()).toBe(true);
    });
});
