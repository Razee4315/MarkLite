import { useRef, useEffect, useCallback } from "react";
import { createScrollSync, type Scroller } from "../utils/scrollSync";
import type { ViewMode } from "../components/ModeToggle";

export interface ScrollSyncControls {
  registerCodeScroller: (s: Scroller | null) => void;
  registerPreviewScroller: (s: Scroller | null) => void;
  onCodeScrollFraction: (f: number) => void;
  onPreviewScrollFraction: (f: number) => void;
}

/**
 * Bidirectional scroll sync between the editor and preview, active only in split
 * mode. One sync controller is created per app lifetime (singleton ref); the
 * register/notify callbacks are stable so wiring them into child effects doesn't
 * cause re-registration churn.
 */
export function useScrollSync(mode: ViewMode): ScrollSyncControls {
  const scrollSyncRef = useRef(createScrollSync());

  // Enable/disable based on view mode.
  useEffect(() => {
    scrollSyncRef.current.setEnabled(mode === "split");
  }, [mode]);

  const registerCodeScroller = useCallback(
    (s: Scroller | null) => scrollSyncRef.current.register("code", s),
    []
  );
  const registerPreviewScroller = useCallback(
    (s: Scroller | null) => scrollSyncRef.current.register("preview", s),
    []
  );
  const onCodeScrollFraction = useCallback(
    (f: number) => scrollSyncRef.current.notify("code", f),
    []
  );
  const onPreviewScrollFraction = useCallback(
    (f: number) => scrollSyncRef.current.notify("preview", f),
    []
  );

  return { registerCodeScroller, registerPreviewScroller, onCodeScrollFraction, onPreviewScrollFraction };
}
