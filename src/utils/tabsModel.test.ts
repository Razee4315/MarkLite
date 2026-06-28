import { describe, it, expect } from "vitest";
import { findTabByPath, isTabDirty, nextActiveAfterClose, type TabState } from "./tabsModel";

const tab = (id: string, filePath: string | null, content = "x", originalContent = "x"): TabState => ({
  id, filePath, fileName: filePath?.split("/").pop() ?? "Untitled.md",
  content, originalContent, fileSize: 0, knownMtime: 0,
});

describe("isTabDirty", () => {
  it("is dirty only when content diverges from the saved original", () => {
    expect(isTabDirty({ content: "a", originalContent: "a" })).toBe(false);
    expect(isTabDirty({ content: "a", originalContent: "b" })).toBe(true);
  });
});

describe("findTabByPath", () => {
  const tabs = [tab("1", "/a.md"), tab("2", "/b.md"), tab("3", null)];
  it("finds by path", () => {
    expect(findTabByPath(tabs, "/b.md")?.id).toBe("2");
  });
  it("never matches a null path (multiple Untitled buffers are distinct)", () => {
    expect(findTabByPath(tabs, null)).toBeUndefined();
  });
  it("returns undefined when not open", () => {
    expect(findTabByPath(tabs, "/missing.md")).toBeUndefined();
  });
});

describe("nextActiveAfterClose", () => {
  const tabs = [tab("1", "/a.md"), tab("2", "/b.md"), tab("3", "/c.md")];

  it("focuses the tab to the right of the closed one", () => {
    expect(nextActiveAfterClose(tabs, "2")).toBe("3");
  });
  it("focuses the left neighbour when closing the last tab", () => {
    expect(nextActiveAfterClose(tabs, "3")).toBe("2");
  });
  it("focuses the new first tab when closing the first", () => {
    expect(nextActiveAfterClose(tabs, "1")).toBe("2");
  });
  it("returns null when closing the only tab", () => {
    expect(nextActiveAfterClose([tab("1", "/a.md")], "1")).toBeNull();
  });
  it("returns null for an unknown id", () => {
    expect(nextActiveAfterClose(tabs, "nope")).toBeNull();
  });
});
