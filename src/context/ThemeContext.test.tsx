import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider, useTheme } from "./ThemeContext";

function FontControls() {
    const { font, setFont, customFont, setCustomFont } = useTheme();
    return (
        <>
            <span data-testid="font">{font}</span>
            <span data-testid="custom-font">{customFont}</span>
            <button onClick={() => setFont("custom")}>Use custom</button>
            <button onClick={() => setCustomFont('Atkinson"; color: red')}>Set family</button>
        </>
    );
}

describe("ThemeProvider custom font", () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.removeAttribute("data-font");
        document.documentElement.style.removeProperty("--font-custom");
    });

    it("persists only a sanitized family and applies the Inter fallback stack", async () => {
        render(<ThemeProvider><FontControls /></ThemeProvider>);

        fireEvent.click(screen.getByText("Use custom"));
        fireEvent.click(screen.getByText("Set family"));

        expect(screen.getByTestId("font")).toHaveTextContent("custom");
        expect(screen.getByTestId("custom-font")).toHaveTextContent("Atkinson color red");
        expect(localStorage.getItem("paperling-custom-font")).toBe("Atkinson color red");
        await waitFor(() => {
            expect(document.documentElement).toHaveAttribute("data-font", "custom");
            expect(document.documentElement.style.getPropertyValue("--font-custom"))
                .toBe('"Atkinson color red", \'Inter\'');
        });
    });
});
