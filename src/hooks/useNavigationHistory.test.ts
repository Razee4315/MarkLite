import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useNavigationHistory } from "./useNavigationHistory";

describe("useNavigationHistory", () => {
  it("starts empty", () => {
    const { result } = renderHook(() => useNavigationHistory());
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.peekBack()).toBeNull();
  });

  it("records normal navigation onto the back stack", () => {
    const { result } = renderHook(() => useNavigationHistory());
    act(() => result.current.commit("normal", "a.md", "b.md"));
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.peekBack()).toBe("a.md");
    expect(result.current.canGoForward).toBe(false);
  });

  it("ignores a no-op navigation to the same file (reload)", () => {
    const { result } = renderHook(() => useNavigationHistory());
    act(() => result.current.commit("normal", "a.md", "a.md"));
    expect(result.current.canGoBack).toBe(false);
  });

  it("moves the current file onto Forward when going back", () => {
    const { result } = renderHook(() => useNavigationHistory());
    act(() => result.current.commit("normal", "a.md", "b.md")); // back: [a]
    act(() => result.current.commit("back", "b.md", "a.md"));    // back: [], fwd: [b]
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(true);
    expect(result.current.peekForward()).toBe("b.md");
  });

  it("round-trips back then forward", () => {
    const { result } = renderHook(() => useNavigationHistory());
    act(() => result.current.commit("normal", "a.md", "b.md"));
    act(() => result.current.commit("back", "b.md", "a.md"));
    act(() => result.current.commit("forward", "a.md", "b.md"));
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.peekBack()).toBe("a.md");
    expect(result.current.canGoForward).toBe(false);
  });

  it("a new normal navigation clears the forward stack (new branch)", () => {
    const { result } = renderHook(() => useNavigationHistory());
    act(() => result.current.commit("normal", "a.md", "b.md"));
    act(() => result.current.commit("back", "b.md", "a.md")); // fwd: [b]
    act(() => result.current.commit("normal", "a.md", "c.md"));
    expect(result.current.canGoForward).toBe(false);
    expect(result.current.peekBack()).toBe("a.md");
  });

  it("reset clears both stacks", () => {
    const { result } = renderHook(() => useNavigationHistory());
    act(() => result.current.commit("normal", "a.md", "b.md"));
    act(() => result.current.reset());
    expect(result.current.canGoBack).toBe(false);
    expect(result.current.canGoForward).toBe(false);
  });
});
