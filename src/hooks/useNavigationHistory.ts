import { useCallback, useRef, useState } from "react";

export type NavMode = "normal" | "back" | "forward";

export interface NavigationHistory {
  /** True when there's a previous file to return to. */
  canGoBack: boolean;
  /** True when a back-navigation can be undone with forward. */
  canGoForward: boolean;
  /** Path that "Back" would load, without mutating anything. */
  peekBack: () => string | null;
  /** Path that "Forward" would load, without mutating anything. */
  peekForward: () => string | null;
  /**
   * Record a completed navigation once a file load actually succeeds. Centralising
   * the mutation here (rather than in the Back/Forward click handlers) keeps the
   * stacks consistent even when an unsaved-changes dialog defers — or cancels —
   * the load.
   *   - normal:  push the file we left onto Back, clear Forward (a new branch).
   *   - back:    pop the target off Back, push the file we left onto Forward.
   *   - forward: pop the target off Forward, push the file we left onto Back.
   * A no-op when `from === to` (e.g. an external-change reload of the same file).
   */
  commit: (mode: NavMode, from: string | null, to: string) => void;
  /** Clear all history (e.g. when starting a fresh blank buffer). */
  reset: () => void;
}

export function useNavigationHistory(): NavigationHistory {
  const backRef = useRef<string[]>([]);
  const forwardRef = useRef<string[]>([]);
  // Re-render so the toolbar's enabled/disabled state tracks the ref-held stacks.
  const [, force] = useState(0);
  const bump = useCallback(() => force((n) => (n + 1) & 0xffff), []);

  const peekBack = useCallback(
    () => backRef.current[backRef.current.length - 1] ?? null,
    []
  );
  const peekForward = useCallback(
    () => forwardRef.current[forwardRef.current.length - 1] ?? null,
    []
  );

  const commit = useCallback(
    (mode: NavMode, from: string | null, to: string) => {
      if (from === to) return;
      if (mode === "back") {
        if (backRef.current[backRef.current.length - 1] === to) backRef.current.pop();
        if (from) forwardRef.current.push(from);
      } else if (mode === "forward") {
        if (forwardRef.current[forwardRef.current.length - 1] === to) forwardRef.current.pop();
        if (from) backRef.current.push(from);
      } else {
        if (from) backRef.current.push(from);
        forwardRef.current = [];
      }
      bump();
    },
    [bump]
  );

  const reset = useCallback(() => {
    backRef.current = [];
    forwardRef.current = [];
    bump();
  }, [bump]);

  return {
    canGoBack: backRef.current.length > 0,
    canGoForward: forwardRef.current.length > 0,
    peekBack,
    peekForward,
    commit,
    reset,
  };
}
