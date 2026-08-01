import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { useFileSession, type UseFileSessionOptions } from "./useFileSession";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));

afterEach(cleanup);

const files = new Map([
  ["C:/a.md", { path: "C:/a.md", name: "a.md", content: "alpha", size: 5, line_count: 1, modified: 10 }],
  ["C:/b.md", { path: "C:/b.md", name: "b.md", content: "bravo", size: 5, line_count: 1, modified: 20 }],
]);

function options(overrides: Partial<UseFileSessionOptions> = {}): UseFileSessionOptions {
  return {
    currentLine: 1,
    autoSaveEnabled: false,
    isReviewActive: false,
    clearReview: vi.fn(),
    setMode: vi.fn(),
    showToast: vi.fn(),
    restoreOnMount: false,
    ...overrides,
  };
}

describe("useFileSession", () => {
  beforeEach(() => {
    localStorage.clear();
    (invoke as Mock).mockReset().mockImplementation((command: string, args?: { path?: string }) => {
      if (command === "read_file" && args?.path) return Promise.resolve(files.get(args.path));
      return Promise.resolve(30);
    });
  });

  it("opens a file into an active tab", async () => {
    const { result } = renderHook(() => useFileSession(options()));

    await act(() => result.current.loadFile("C:/a.md"));

    expect(result.current.filePath).toBe("C:/a.md");
    expect(result.current.fileName).toBe("a.md");
    expect(result.current.content).toBe("alpha");
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.activeTabId).toBe(result.current.tabs[0].id);
  });

  it("preserves edits while switching between tabs", async () => {
    const { result } = renderHook(() => useFileSession(options()));
    await act(() => result.current.loadFile("C:/a.md"));
    const firstId = result.current.activeTabId!;
    await act(() => result.current.loadFile("C:/b.md"));
    const secondId = result.current.activeTabId!;

    act(() => result.current.setContent("edited bravo"));
    act(() => result.current.activateTab(firstId));
    expect(result.current.content).toBe("alpha");

    act(() => result.current.activateTab(secondId));
    expect(result.current.content).toBe("edited bravo");
    expect(result.current.isDirty).toBe(true);
  });

  it("closes a clean tab and activates its neighbour", async () => {
    const { result } = renderHook(() => useFileSession(options()));
    await act(() => result.current.loadFile("C:/a.md"));
    const firstId = result.current.activeTabId!;
    await act(() => result.current.loadFile("C:/b.md"));

    act(() => result.current.closeTab(result.current.activeTabId!));

    expect(result.current.tabs.map((tab) => tab.fileName)).toEqual(["a.md"]);
    expect(result.current.activeTabId).toBe(firstId);
    expect(result.current.filePath).toBe("C:/a.md");
  });

  it("keeps a dirty tab open and requests confirmation before closing", async () => {
    const { result } = renderHook(() => useFileSession(options()));
    await act(() => result.current.loadFile("C:/a.md"));
    act(() => result.current.setContent("edited alpha"));

    act(() => result.current.closeTab(result.current.activeTabId!));

    await waitFor(() => expect(result.current.closeTabPrompt?.fileName).toBe("a.md"));
    expect(result.current.tabs).toHaveLength(1);
    expect(result.current.isDirty).toBe(true);
  });
});
