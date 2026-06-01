import { useCallback, useState } from "react";
import type { ToastType } from "../components/Toast";

export interface ToastState {
    message: string;
    isVisible: boolean;
    type: ToastType;
}

/** Toast notification state + show/hide helpers, extracted from App so the
 *  component doesn't carry the state or the hide-guard rationale inline. */
export function useToast() {
    const [toast, setToast] = useState<ToastState>({ message: "", isVisible: false, type: "success" });

    const showToast = useCallback((message: string, type: ToastType = "success") => {
        setToast({ message, isVisible: true, type });
    }, []);

    const hideToast = useCallback(() => {
        // Bail out when the toast is already hidden — without this guard, a
        // duplicate hide call (e.g. from a quick second toast cancelling the
        // first) allocates a fresh object even though `isVisible: false` was
        // already true, triggering a Toast re-render that schedules a fresh
        // pair of fade/hide timers.
        setToast((prev) => (prev.isVisible ? { ...prev, isVisible: false } : prev));
    }, []);

    return { toast, showToast, hideToast };
}
