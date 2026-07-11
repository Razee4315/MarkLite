// Reader-mode adapter for the shared FindBar (FIND-01). Searches the rendered
// markdown text nodes and highlights matches with the CSS Custom Highlight API —
// no DOM mutation, so react-markdown's tree is untouched. On webviews without
// the Highlight API (none of our targets, but belt-and-braces) navigation still
// works; only the visual highlight is skipped.
//
// Matches that span element boundaries (e.g. "bold**text**") aren't found —
// acceptable for a reading aid, the same trade-off VS Code's webview find makes.

import type { FindController, FindOpts, FindResult } from "../components/FindBar";

const MAX_MATCHES = 5000;
const HIGHLIGHT_ALL = "paperling-find";
const HIGHLIGHT_ACTIVE = "paperling-find-active";

type HighlightsRegistry = Map<string, unknown> & {
    set(name: string, highlight: unknown): void;
    delete(name: string): void;
};

const cssHighlights = (): HighlightsRegistry | null => {
    const css = (globalThis as { CSS?: { highlights?: HighlightsRegistry } }).CSS;
    return css?.highlights ?? null;
};

const HighlightCtor = (): (new (...r: Range[]) => unknown) | undefined =>
    (globalThis as unknown as { Highlight?: new (...r: Range[]) => unknown }).Highlight;

function collectMatches(root: HTMLElement, query: string, caseSensitive: boolean): Range[] {
    const ranges: Range[] = [];
    if (!query) return ranges;
    const q = caseSensitive ? query : query.toLowerCase();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
        const data = (node as Text).data;
        const text = caseSensitive ? data : data.toLowerCase();
        let i = text.indexOf(q);
        while (i !== -1) {
            const r = new Range();
            r.setStart(node, i);
            r.setEnd(node, i + q.length);
            ranges.push(r);
            if (ranges.length >= MAX_MATCHES) return ranges;
            i = text.indexOf(q, i + q.length);
        }
    }
    return ranges;
}

/**
 * Build a FindController over a rendered-markdown root. `rootRef` is read at call
 * time, so it tracks whichever preview element is currently mounted.
 */
export function createPreviewFindController(
    rootRef: React.RefObject<HTMLElement | null>
): FindController {
    let ranges: Range[] = [];

    const clear = () => {
        ranges = [];
        const reg = cssHighlights();
        if (reg) {
            reg.delete(HIGHLIGHT_ALL);
            reg.delete(HIGHLIGHT_ACTIVE);
        }
    };

    return {
        supportsReplace: false,
        supportsRegex: false,
        isValidPattern: () => true,

        search(query: string, opts: FindOpts): FindResult {
            const root = rootRef.current;
            ranges = root ? collectMatches(root, query.trim(), opts.caseSensitive) : [];
            const reg = cssHighlights();
            const H = HighlightCtor();
            if (reg) {
                if (H && ranges.length) reg.set(HIGHLIGHT_ALL, new H(...ranges));
                else reg.delete(HIGHLIGHT_ALL);
                reg.delete(HIGHLIGHT_ACTIVE);
            }
            return { count: ranges.length, activeIndex: ranges.length ? 0 : -1 };
        },

        setActive(index: number) {
            const r = ranges[index];
            if (!r) return;
            const reg = cssHighlights();
            const H = HighlightCtor();
            if (reg && H) reg.set(HIGHLIGHT_ACTIVE, new H(r));
            r.startContainer.parentElement?.scrollIntoView({ block: "center", behavior: "auto" });
        },

        clear,
    };
}
