import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createScrollSync, type Scroller } from "./scrollSync";

const mockScroller = () => {
    const calls: number[] = [];
    const s: Scroller = { setFraction: (f) => calls.push(f) };
    return { s, calls };
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("createScrollSync", () => {
    it("does nothing while disabled", () => {
        const sync = createScrollSync();
        const code = mockScroller();
        const preview = mockScroller();
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.notify("code", 0.5);
        expect(preview.calls).toEqual([]);
    });

    it("mirrors one side's fraction to the other when enabled", () => {
        const sync = createScrollSync();
        const code = mockScroller();
        const preview = mockScroller();
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.setEnabled(true);
        sync.notify("code", 0.5);
        expect(preview.calls).toEqual([0.5]);
    });

    it("clamps the fraction into [0,1]", () => {
        const sync = createScrollSync();
        const code = mockScroller();
        const preview = mockScroller();
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.setEnabled(true);
        sync.notify("code", 1.5);
        expect(preview.calls).toEqual([1]);
    });

    it("suppresses the echo from a programmatic scroll, then resumes after the window", () => {
        const sync = createScrollSync();
        const code = mockScroller();
        const preview = mockScroller();
        sync.register("code", code.s);
        sync.register("preview", preview.s);
        sync.setEnabled(true);

        sync.notify("code", 0.5); // drives preview; marks preview as ignoring
        expect(preview.calls).toEqual([0.5]);

        sync.notify("preview", 0.7); // echo from the programmatic scroll -> dropped
        expect(code.calls).toEqual([]);

        vi.advanceTimersByTime(100); // ignore window (80ms) elapses
        sync.notify("preview", 0.7); // genuine user scroll now propagates
        expect(code.calls).toEqual([0.7]);
    });
});
