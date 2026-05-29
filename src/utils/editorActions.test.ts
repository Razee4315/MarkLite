import { describe, it, expect } from "vitest";
import {
    handleTab,
    handleEnter,
    handleAutoPair,
    handleSkipCloser,
    handleBackspace,
    wrapSelection,
    insertLink,
    type EditorState,
} from "./editorActions";

const st = (text: string, selStart: number, selEnd: number = selStart): EditorState => ({ text, selStart, selEnd });

describe("handleAutoPair", () => {
    it("inserts a closing pair on empty selection and centers the caret", () => {
        const r = handleAutoPair(st("", 0), "(");
        expect(r).toEqual({ text: "()", selStart: 1, selEnd: 1 });
    });

    it("wraps a non-empty selection", () => {
        const r = handleAutoPair(st("abc", 0, 3), "(");
        expect(r).toEqual({ text: "(abc)", selStart: 1, selEnd: 4 });
    });

    it("does not auto-pair a quote next to a word char (apostrophe)", () => {
        expect(handleAutoPair(st("a", 1), "'")).toBeNull();
    });

    it("returns null for a non-pairing char", () => {
        expect(handleAutoPair(st("", 0), "z")).toBeNull();
    });
});

describe("handleSkipCloser", () => {
    it("types past an existing closer", () => {
        expect(handleSkipCloser(st("()", 1), ")")).toEqual({ text: "()", selStart: 2, selEnd: 2 });
    });
    it("returns null when next char is not the closer", () => {
        expect(handleSkipCloser(st("(", 1), ")")).toBeNull();
    });
});

describe("handleBackspace", () => {
    it("erases an empty auto-pair as a unit", () => {
        expect(handleBackspace(st("()", 1))).toEqual({ text: "", selStart: 0, selEnd: 0 });
    });
    it("returns null for normal backspace", () => {
        expect(handleBackspace(st("ab", 2))).toBeNull();
    });
});

describe("wrapSelection", () => {
    it("wraps a selection with markers", () => {
        expect(wrapSelection(st("bold", 0, 4), "**", "**")).toEqual({ text: "**bold**", selStart: 2, selEnd: 6 });
    });
    it("toggles (unwraps) an already-wrapped selection", () => {
        // selecting "bold" inside "**bold**"
        expect(wrapSelection(st("**bold**", 2, 6), "**", "**")).toEqual({ text: "bold", selStart: 0, selEnd: 4 });
    });
});

describe("insertLink", () => {
    it("uses a pasted-looking URL as the href and puts caret in the text slot", () => {
        const r = insertLink(st("https://x.com", 0, 13));
        expect(r.text).toBe("[](https://x.com)");
        expect(r.selStart).toBe(1);
    });
    it("treats plain selection as link text and selects the url placeholder", () => {
        const r = insertLink(st("click", 0, 5));
        expect(r.text).toBe("[click](url)");
        expect(r.text.slice(r.selStart, r.selEnd)).toBe("url");
    });
});

describe("handleEnter", () => {
    it("continues a bullet list", () => {
        expect(handleEnter(st("- a", 3))?.text).toBe("- a\n- ");
    });
    it("increments a numbered list", () => {
        expect(handleEnter(st("1. a", 4))?.text).toBe("1. a\n2. ");
    });
    it("terminates an empty list item", () => {
        expect(handleEnter(st("- ", 2))?.text).toBe("\n");
    });
    it("continues a blockquote", () => {
        expect(handleEnter(st("> hi", 4))?.text).toBe("> hi\n> ");
    });
    it("returns null on a plain line", () => {
        expect(handleEnter(st("plain", 5))).toBeNull();
    });
});

describe("handleTab", () => {
    it("inserts indent on a single line", () => {
        expect(handleTab(st("abc", 0), false)).toEqual({ text: "  abc", selStart: 2, selEnd: 2 });
    });
    it("indents every line of a multi-line selection", () => {
        const r = handleTab(st("a\nb", 0, 3), false);
        expect(r?.text).toBe("  a\n  b");
    });
    it("outdents with shift", () => {
        const r = handleTab(st("  abc", 2), true);
        expect(r?.text).toBe("abc");
    });
    it("moves to the next table cell", () => {
        // "| a | b |" — caret in first cell -> jumps into second cell
        const r = handleTab(st("| a | b |", 2), false);
        expect(r?.selStart).toBe(6);
    });
});
