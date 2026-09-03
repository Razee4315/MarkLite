// Zen-mode top bar (ZEN-02): hover-reveal panel with the Normal exit button
// and the three window controls. Hidden by default (invisible, not merely
// transparent, so the buttons leave the tab order until revealed).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

// No IPC host under jsdom; the window controls only need to exist.
vi.mock("@tauri-apps/api/window", () => ({
    Window: {
        getCurrent: () => ({
            minimize: async () => {},
            toggleMaximize: async () => {},
            startDragging: async () => {},
            close: async () => {},
        }),
    },
}));

import { ZenTopBar } from "./ZenTopBar";

afterEach(cleanup);

const renderBar = (props: Partial<Parameters<typeof ZenTopBar>[0]> = {}) =>
    render(<ZenTopBar onExitZen={() => {}} {...props} />);

describe("ZenTopBar", () => {
    it("stays hidden until hovered (out of the tab order while hidden)", () => {
        renderBar();
        const bar = screen.getByRole("toolbar", { name: "Zen mode top bar" });
        expect(bar).toHaveClass("invisible");
        expect(bar).toHaveClass("opacity-0");
        expect(bar).toHaveClass("group-hover/zenbar:visible");
        expect(bar).toHaveClass("group-hover/zenbar:opacity-100");
    });

    it("offers Normal plus minimize, maximize, and close", () => {
        renderBar();
        expect(screen.getByRole("button", { name: "Exit Zen mode" })).toHaveTextContent("Normal");
        expect(screen.getByRole("button", { name: "Minimize" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Maximize" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
    });

    it("exits zen when Normal is clicked", () => {
        const onExitZen = vi.fn();
        renderBar({ onExitZen });
        fireEvent.click(screen.getByRole("button", { name: "Exit Zen mode" }));
        expect(onExitZen).toHaveBeenCalledTimes(1);
    });

    it("labels the maximize button as exit-fullscreen while fullscreen", () => {
        renderBar({ isFullscreen: true, onToggleFullscreen: () => {} });
        expect(screen.getByRole("button", { name: "Exit fullscreen" })).toBeInTheDocument();
    });
});
