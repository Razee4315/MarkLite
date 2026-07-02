import { describe, it, expect } from "vitest";
import {
  findTabByPath,
  isTabDirty,
  nextActiveAfterClose,
  nextUntitledName,
  findReusableUntitledTab,
  computeTabLabels,
  moveTab,
  type TabState,
} from "./tabsModel";

const tab = (id: string, filePath: string | null, content = "x", originalContent = "x"): TabState => ({
  id, filePath, fileName: filePath?.replace(/\\/g, "/").split("/").pop() ?? "Untitled.md",
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

describe("nextUntitledName", () => {
  const untitled = (id: string, name: string): TabState => ({
    id, filePath: null, fileName: name, content: "", originalContent: "", fileSize: 0, knownMtime: 0,
  });
  it("starts at Untitled-1.md", () => {
    expect(nextUntitledName([])).toBe("Untitled-1.md");
  });
  it("skips names already in use", () => {
    expect(nextUntitledName([untitled("1", "Untitled-1.md")])).toBe("Untitled-2.md");
  });
  it("fills the lowest gap", () => {
    expect(nextUntitledName([untitled("1", "Untitled-1.md"), untitled("3", "Untitled-3.md")])).toBe("Untitled-2.md");
  });
  it("ignores saved files with the same name", () => {
    expect(nextUntitledName([tab("1", "/x/Untitled-1.md")])).toBe("Untitled-1.md");
  });
});

describe("findReusableUntitledTab", () => {
  it("finds a pristine empty untitled buffer", () => {
    const tabs = [tab("1", "/a.md"), { ...tab("2", null), content: "", originalContent: "" }];
    expect(findReusableUntitledTab(tabs)?.id).toBe("2");
  });
  it("ignores an untitled buffer that has content", () => {
    const tabs = [{ ...tab("2", null), content: "hi", originalContent: "" }];
    expect(findReusableUntitledTab(tabs)).toBeUndefined();
  });
  it("ignores saved files", () => {
    expect(findReusableUntitledTab([tab("1", "/a.md")])).toBeUndefined();
  });
});

describe("computeTabLabels", () => {
  it("shows the bare name when unique", () => {
    const labels = computeTabLabels([{ id: "1", fileName: "a.md", filePath: "/x/a.md" }]);
    expect(labels.get("1")).toBe("a.md");
  });
  it("appends the distinguishing parent folder for duplicates", () => {
    const labels = computeTabLabels([
      { id: "1", fileName: "README.md", filePath: "/proj/docs/README.md" },
      { id: "2", fileName: "README.md", filePath: "/proj/src/README.md" },
    ]);
    expect(labels.get("1")).toBe("README.md — docs");
    expect(labels.get("2")).toBe("README.md — src");
  });
  it("walks further up when the immediate parent also collides", () => {
    const labels = computeTabLabels([
      { id: "1", fileName: "README.md", filePath: "/a/docs/README.md" },
      { id: "2", fileName: "README.md", filePath: "/b/docs/README.md" },
    ]);
    expect(labels.get("1")).toBe("README.md — a/docs");
    expect(labels.get("2")).toBe("README.md — b/docs");
  });
  it("handles Windows separators", () => {
    const labels = computeTabLabels([
      { id: "1", fileName: "note.md", filePath: "C:\\one\\note.md" },
      { id: "2", fileName: "note.md", filePath: "C:\\two\\note.md" },
    ]);
    expect(labels.get("1")).toBe("note.md — one");
    expect(labels.get("2")).toBe("note.md — two");
  });
});

describe("moveTab", () => {
  const tabs = [tab("1", "/a.md"), tab("2", "/b.md"), tab("3", "/c.md")];
  it("moves a tab to a later position", () => {
    expect(moveTab(tabs, 0, 2).map((t) => t.id)).toEqual(["2", "3", "1"]);
  });
  it("moves a tab to an earlier position", () => {
    expect(moveTab(tabs, 2, 0).map((t) => t.id)).toEqual(["3", "1", "2"]);
  });
  it("returns the same array for a no-op or out-of-range move", () => {
    expect(moveTab(tabs, 1, 1)).toBe(tabs);
    expect(moveTab(tabs, -1, 0)).toBe(tabs);
    expect(moveTab(tabs, 0, 9)).toBe(tabs);
  });
});
