import { describe, expect, it } from "vitest";
import { pickBootFile } from "./boot";

describe("pickBootFile", () => {
    // Regression: a double-clicked file must beat the session restore.
    // Before the fix the app could reopen the previous session's file even
    // though the user launched it by double-clicking a different one.
    it("prefers the OS-opened (CLI) file over the last-session file", () => {
        expect(pickBootFile("C:\\notes\\clicked.md", "C:\\notes\\old.md")).toEqual({
            path: "C:\\notes\\clicked.md",
            source: "cli",
        });
    });

    it("falls back to the last-session file when no CLI file is present", () => {
        expect(pickBootFile(null, "C:\\notes\\old.md")).toEqual({
            path: "C:\\notes\\old.md",
            source: "last",
        });
    });

    it("returns none when there is nothing to open", () => {
        expect(pickBootFile(null, null)).toEqual({ path: null, source: "none" });
    });
});
