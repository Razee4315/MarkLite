# MarkLite — Comprehensive Audit & Remediation Plan

> **Version audited:** 0.6.14
> **Stack:** Tauri 2 · React 19 · Vite 7 · TypeScript 5.8 · Tailwind 4
> **Date:** 2026-05-29
> **Scope:** Full code review, UI/UX & accessibility, performance, security.
> **Status:** Findings only — no code was changed. This document is the source of truth for the improvement work that follows.

---

## How to read this document

- Findings are grouped by theme and each has a stable **ID** (e.g. `EDITOR-01`) so you can reference them in commits/PRs.
- **Severity** uses: `Critical` (breaks core UX or security), `High`, `Medium`, `Low`, `Info`.
- Every finding cites **`file:line`** evidence so you can jump straight to the code.
- Each finding ends with a **Fix** (concrete, often with code) and an **Effort** estimate.
- The **Remediation Roadmap** at the end sequences everything into P0/P1/P2.

### Severity legend

| Severity | Meaning |
|---|---|
| 🔴 Critical | Directly causes a reported user-facing failure, data risk, or makes a feature unusable. |
| 🟠 High | Significant degradation or latent serious problem; fix soon. |
| 🟡 Medium | Real issue, noticeable, but not blocking. |
| 🔵 Low | Polish, minor inefficiency, or defense-in-depth. |
| ⚪ Info | Context / by-design note, no action required. |

---

## Executive summary

The three problems you reported are all genuine. Two of them (typing slowness and caret misalignment) share a **single architectural root cause**: the code editor is a hand-rolled "transparent `<textarea>` stacked over a syntax-highlight `<div>` overlay." A fourth complaint (AI is broken) is actually a **discoverability** problem — the feature works via **Alt+J** but has no button and Windows' WebView2 swallows the Ctrl+J shortcut.

| # | Your words | Verdict | Root cause | Section |
|---|---|---|---|---|
| 1 | "very slow, especially in editing mode" | ✅ Real | Visible glyphs live in an overlay `<div>`; the textarea text is transparent. Overlay re-render time becomes *visible* keystroke latency. Scales badly with document size; virtualization is off in the default mode. | [§2](#2-editor-architecture--the-core-problem), [§4](#4-editor-performance-findings) |
| 2 | "cursor showing somewhere, text and cursor not aligned" | ✅ Real | Same dual-layer design. Caret (textarea) and glyphs (overlay) are two layers that must agree pixel-for-pixel; they diverge under word-wrap (default ON) and fractional Windows display scaling. | [§2](#2-editor-architecture--the-core-problem) |
| 3 | "live view lags behind what I type" | ✅ Real | `react-markdown` re-parses + re-highlights the **whole document** synchronously every 80 ms; highlight.js runs language **auto-detection**; Mermaid re-renders from scratch. | [§5](#5-live-preview-performance-findings) |
| 4 | "AI is broken, can't open it, no button" | ⚠️ Not broken — **undiscoverable** | Works via **Alt+J**. Ctrl+J is eaten by WebView2 (Windows). No button, no palette entry, no status. | [§6](#6-ai-feature-findings) |

**The single highest-leverage decision** is whether to replace the hand-rolled editor with **CodeMirror 6** ([EDITOR-00](#editor-00--strategic-replace-the-textarea-overlay-editor-with-codemirror-6)). It retires the entire class of typing-latency and cursor-drift bugs at once, plus gives you proper virtualization, incremental highlighting, and large-file handling. The git history — `perf/instant-typing-feedback`, `perf/typing-latency`, `perf/render-and-bundle-optimization`, the merged-then-reverted "flip textarea visibility" (`8e1fbfb` → `30c0d54`) — is the fingerprint of an architecture being fought repeatedly rather than a tuning gap.

**What's genuinely good** (so we don't regress it): per-line highlight caching, broad memoization, lazy code-splitting of heavy deps, a tight CSP, enforced file-size caps with stat-before-read, path-traversal guards with Rust unit tests, reduced-motion support, and a documented WCAG contrast fix in the Paper theme. This is a carefully optimized codebase that has hit an architectural ceiling, not a sloppy one.

---

## Table of contents

1. [Project overview](#1-project-overview)
2. [Editor architecture — the core problem](#2-editor-architecture--the-core-problem)
3. [Cursor / caret misalignment](#3-cursor--caret-misalignment-findings)
4. [Editor performance](#4-editor-performance-findings)
5. [Live preview performance](#5-live-preview-performance-findings)
6. [AI feature](#6-ai-feature-findings)
7. [Security](#7-security-findings)
8. [UI/UX & accessibility](#8-uiux--accessibility-findings)
9. [Code quality, testing & build](#9-code-quality-testing--build-findings)
10. [Remediation roadmap (P0/P1/P2)](#10-remediation-roadmap)
11. [Appendix A — file inventory](#appendix-a--file-inventory)
12. [Appendix B — how to verify each reported bug](#appendix-b--how-to-verify-each-reported-bug)
13. [Appendix C — testing strategy](#appendix-c--testing-strategy)

---

## 1. Project overview

MarkLite is a desktop Markdown editor. Front end is React 19 + Vite + Tailwind 4; backend is Tauri 2 (Rust) exposing file IO commands. Rendering pipeline: `react-markdown` + `remark-gfm` + `remark-math` + `rehype-highlight` + `rehype-katex` (+ mhchem) + `mermaid`. Export via `jspdf`; HTML→MD via `turndown`.

**Key source files**

| Area | File |
|---|---|
| App shell, state, shortcuts, layout | `src/App.tsx` (1224 lines) |
| Code editor (textarea + overlay) | `src/components/CodeEditor.tsx` (1141 lines) |
| Markdown preview pipeline | `src/components/MarkdownPreview.tsx` |
| Mermaid rendering | `src/components/MermaidBlock.tsx` |
| AI bubble UI | `src/components/AIBubble.tsx` |
| AI client | `src/utils/aiAssist.ts` |
| Scroll sync controller | `src/utils/scrollSync.ts` |
| localStorage persistence (+ AI config) | `src/utils/persistence.ts` |
| Theme tokens, editor CSS, scrollbar | `src/index.css` (819 lines) |
| Rust file IO + image sanitization | `src-tauri/src/commands.rs` |
| Tauri app setup | `src-tauri/src/lib.rs`, `main.rs` |
| Capabilities / permissions | `src-tauri/capabilities/default.json` |
| CSP / window config | `src-tauri/tauri.conf.json` |
| Bundle/code-split config | `vite.config.ts` |
| Font loading | `src/fonts.ts` |

**Default settings that matter for the bugs:** word-wrap defaults **ON** (`persistence.ts:73`), view mode defaults `preview` (`persistence.ts:55-56`), toolbar defaults **OFF** (`persistence.ts:71`), spell-check OFF, typewriter OFF.

---

## 2. Editor architecture — the core problem

### The design

`CodeEditor.tsx` stacks two layers inside the editor container (`CodeEditor.tsx:1014-1128`):

1. **Highlight overlay** — a `<div>` (`CodeEditor.tsx:1022-1057`) that renders the *visible*, colored text as per-line `<div>`s, `pointer-events:none`, `aria-hidden`.
2. **Transparent textarea** — on top (`CodeEditor.tsx:1110-1127`), `text-transparent` with an opaque `caret-[var(--accent)]`. It owns input, selection, scrolling, and the blinking caret. **Its own text is invisible.**

Both layers share a locked metric block `sharedTextStyle` (`CodeEditor.tsx:49-81`) and a `wrapStyle` (`CodeEditor.tsx:198-200`) so they *try* to lay text out identically.

### Why this causes BOTH headline bugs

**(a) Visible typing latency.** Because the textarea's text is transparent, **the character you type is not visible until React re-renders the overlay.** Path per keystroke:

```
keydown/input
  → onChange(e.target.value)            CodeEditor.tsx:218-220
  → setContent(...)                     App.tsx:608-610
  → AppContent re-render
  → CodeEditor re-render (memo busts: content changed)
  → lines = content.split("\n")         CodeEditor.tsx:215
  → highlightedLines rebuild (cached)   CodeEditor.tsx:610-638
  → reconcile overlay <div>s            CodeEditor.tsx:1048-1056
  → paint
```

A native textarea paints the glyph instantly; here the glyph waits for that whole chain. On small docs it's <16 ms (fine). On hundreds–thousands of lines it's tens of ms, so the caret visibly runs ahead of the letter. The reverted commit `8e1fbfb perf(editor): typing now feels native — flip textarea visibility` was an attempt to mask exactly this and had to be rolled back (`30c0d54`) because flipping broke scroll sync. **You cannot memoize your way out of this; the latency is structural.**

**(b) Caret drifts off glyphs.** The two layers must agree on font metrics, line height, padding, wrapping, and scrollbar width to the sub-pixel. The code enforces this with an unusual amount of defensive CSS — locking `fontWeight`, `fontStyle`, `fontVariantLigatures:"none"`, `fontFeatureSettings`, `fontKerning:"none"`, `letterSpacing:"0px"`, `scrollbarGutter:"stable"` (`CodeEditor.tsx:49-81`) and a custom transparent-scrollbar rule (`index.css:379-404`). The fact that all of this is *required* is the architectural smell. Two divergence triggers survive the defenses — see [§3](#3-cursor--caret-misalignment-findings).

---

### EDITOR-00 — 🔴 Strategic: replace the textarea-overlay editor with CodeMirror 6

**Severity:** Critical (root cause of EDITOR-01..05 and CURSOR-01..03)
**Locations:** entire `src/components/CodeEditor.tsx`; downstream `src/utils/editorActions.ts`, `src/utils/smartPaste.ts`, `src/components/FindReplaceBar.tsx`, `SlashMenu.tsx`, `FormatToolbar.tsx`, AI-bubble anchoring.

**Problem.** The dual-layer approach has a hard ceiling: glyph latency = overlay render time, and caret accuracy = perfect cross-layer metric agreement. Both fail predictably as documents grow and under fractional display scaling.

**Fix.** Migrate the editor to **CodeMirror 6** (`@codemirror/*`, `@codemirror/lang-markdown`, `@lezer/highlight`). In CM6 the caret and the rendered text are the **same** layer — cross-layer drift becomes *impossible* — and it renders only the visible viewport with incremental Lezer highlighting, so large files stay fast. This is the recommended path.

**What must be re-implemented on top of CM6 to reach feature parity** (so nothing is lost):
- Line-number gutter (`lineNumbers()` extension) + active-line highlight (`highlightActiveLine()`).
- Word-wrap toggle (`EditorView.lineWrapping`, conditionally added).
- Typewriter / centered-caret mode (scroll effect on selection change; replaces `CodeEditor.tsx:723-745`).
- Markdown editing helpers currently in `editorActions.ts` (Tab/Enter/auto-pair/backspace/wrap/link) → CM6 `keymap` + transactions.
- Smart paste (`smartPaste.ts`) and image paste (`imageUtils.ts`) → `EditorView.domEventHandlers({ paste })`.
- Slash menu (`SlashMenu.tsx`) → autocompletion or a widget anchored via `view.coordsAtPos`.
- AI bubble anchoring → `view.coordsAtPos(selectionHead)` (replaces the manual pixel math at `CodeEditor.tsx:271-278`).
- Find/replace (`FindReplaceBar.tsx`) → `@codemirror/search`.
- Scroll-fraction sync (`registerScroller`) → read/write `view.scrollDOM.scrollTop`.
- Theme tokens → a CM6 `EditorView.theme` driven by the same CSS variables in `index.css`.

**Effort:** ~1–2 focused days to parity. **Payoff:** retires EDITOR-01..05, CURSOR-01..03, and most of [§4] in one move.

**Alternative if you defer the rewrite:** apply the incremental band-aids in [§3]/[§4]. Be aware these are the same class of fix already tried and reverted; they reduce but do not eliminate the symptoms.

---

## 3. Cursor / caret misalignment findings

### CURSOR-01 — 🔴 Word-wrap (default ON) can wrap differently in the textarea vs. the overlay

**Severity:** Critical
**Location:** `CodeEditor.tsx:198-200` (wrapStyle), `:103-120` (`RenderedLines` per-line `<div>`s), `:93-97` (wrap line style); default `persistence.ts:73`.

**Problem.** In wrap mode the overlay wraps **each source line inside its own `<div>`** with `white-space:pre-wrap; word-break:break-word; overflow-wrap:anywhere`, while the textarea wraps the text as **one continuous flow** with the same properties. Browsers do **not** guarantee identical line-breaking between a `<textarea>` and block `<div>`s — especially with `word-break:break-word` **and** `overflow-wrap:anywhere` together, and around long unbroken tokens, trailing spaces, and tabs. If a single line wraps to a different number of visual rows in one layer, **every line below it is vertically offset, cumulatively** — so the caret sits progressively further from the glyph as you go down the document. This matches "cursor showing somewhere, not aligned."

**Corroborating evidence in the code:** the active-line highlight band is explicitly **disabled in wrap mode** (`CodeEditor.tsx:1037`, comment at `:1018-1021`) because "its fixed Y assumes uniform line heights" — i.e. the authors already know per-line heights aren't predictable when wrapping.

**Fix.**
- **Best:** EDITOR-00 (CM6 has one text layer; no cross-layer wrap mismatch possible).
- **Interim mitigations:** (1) Add a visible toggle and consider defaulting wrap **off** until fixed, so horizontal-scroll mode (which aligns reliably) is the safe default. (2) If keeping the overlay, render the overlay as a **single text flow** that mirrors the textarea exactly (one container, `\n`-joined text with inline spans) instead of one `<div>` per line, so both use identical continuous wrapping. (3) Avoid combining `word-break:break-word` with `overflow-wrap:anywhere`; pick one and match it on both layers.

**Effort:** Interim mitigation (2) is moderate and risky; the real fix is EDITOR-00.

---

### CURSOR-02 — 🟠 Fractional Windows display scaling causes sub-pixel line-box drift

**Severity:** High
**Location:** `CodeEditor.tsx:44-46` (`EDITOR_FONT_SIZE=14`, `EDITOR_LINE_HEIGHT=24`), overlay vs textarea layout.

**Problem.** At 125%/150% Windows display scaling (very common on Win10/11 laptops), `14px` glyph metrics and `24px` line boxes round differently inside the textarea's native text engine vs. the overlay div's CSS box model. Sub-pixel rounding accumulates per line → cumulative vertical caret drift. This is inherent to having two independent layout layers and cannot be fully eliminated while the architecture stands.

**Fix.** EDITOR-00. (Interim: choosing an integer-friendly line-height and disabling subpixel AA differences helps marginally but does not solve it.)

**Effort:** Solved by EDITOR-00.

---

### CURSOR-03 — 🟡 Font-not-loaded-yet flash can mis-measure the overlay on first paint

**Severity:** Medium
**Location:** `src/fonts.ts:62-63` (eager `document.fonts.load` for mono), `CodeEditor.tsx:42-43` (font stack), overlay initial render.

**Problem.** If the overlay renders before **JetBrains Mono** finishes loading, it lays out with the fallback `monospace`, then reflows when the real font arrives — a brief misalignment window on cold start / first file open. The code does kick off `document.fonts.load` for the mono face, which mitigates but doesn't fully gate first paint.

**Fix.** Gate the editor's first meaningful paint on `document.fonts.ready` for the mono face, or render the overlay invisible until the font is confirmed loaded. Solved structurally by EDITOR-00 (single layer measures itself).

**Effort:** Low.

---

## 4. Editor performance findings

### EDITOR-01 — 🟠 Virtualization is OFF in the default (word-wrap) mode

**Severity:** High
**Location:** `CodeEditor.tsx:659` — `const shouldVirtualize = !wordWrap && lineCount > RENDER_ALL_THRESHOLD;`

**Problem.** Word-wrap defaults **ON** (`persistence.ts:73`), so `shouldVirtualize` is **always false by default**. The overlay therefore uses `RenderedLines` (`CodeEditor.tsx:103-120`), rendering **all N lines**. Worse, `RenderedLines` is `memo`'d on its `lines` prop (`:103`), but `highlightedLines` is a **freshly allocated array every render** (`:610-638`), so the memo **misses on every keystroke** → React reconciles all N line `<div>`s per key. On a large doc in the default config, this is a primary typing-lag contributor. The carefully built `VirtualizedHighlight` path (`:126-154`) only ever runs in non-wrap mode.

**Fix.**
- Best: EDITOR-00 (CM6 virtualizes natively, wrap or not).
- Interim: implement wrapped-line virtualization (requires measuring/estimating wrapped row counts per line, e.g. via a `ResizeObserver` or average-char-width estimate), or memoize `RenderedLines` against a stable structure so unchanged lines don't reconcile. Note the per-line node cache (`:589-638`) already returns stable node refs for unchanged lines — the bottleneck is the parent array identity + lack of windowing, not the nodes themselves.

**Effort:** Interim is moderate/risky; EDITOR-00 solves it.

---

### EDITOR-02 — 🟡 Line-number gutter is never virtualized and re-renders on every caret line change

**Severity:** Medium
**Location:** `CodeEditor.tsx:160-192` (`Gutter`), mounted at `:1010-1012`.

**Problem.** `Gutter` builds `Array.from({ length: lineCount })` — all N number rows — and is `memo`'d on `{ lineCount, activeLine }`. Since `activeLine` changes every time the caret moves to a different line, the gutter **re-renders all N rows on every vertical caret move** (arrow up/down, Enter, click). On a multi-thousand-line no-wrap doc that's thousands of DOM nodes reconciled per cursor move. (Gutter is hidden in wrap mode — `:1010` — so this bites the no-wrap large-file case.)

**Fix.** Virtualize the gutter to the visible window (reuse `visibleRange`), and/or render the active-line number via CSS/`:1037`-style band rather than re-rendering the whole column. Solved by EDITOR-00 (`lineNumbers()` is windowed).

**Effort:** Low–Medium.

---

### EDITOR-03 — 🔵 Global `selectionchange` listener runs on every keystroke

**Severity:** Low
**Location:** `CodeEditor.tsx:510-534`, `updateCursorPosition` `:484-507`.

**Problem.** A `document`-level `selectionchange` handler plus `keyup`/`click`/`focus` all call `updateCursorPosition`, which does `value.substring(0,pos).split("\n")`. There's a good `lastCursorRef` short-circuit (`:481-496`) to skip duplicate work, but the substring/split is still O(cursor offset) and runs on a document-global event. Minor on small docs; measurable on huge ones.

**Fix.** Debounce/coalesce cursor reporting to one per animation frame, or compute line/col incrementally. Solved by EDITOR-00 (`view.state.selection` is O(1)).

**Effort:** Low.

---

### EDITOR-04 — 🔵 `applyResult` uses `requestAnimationFrame` to restore selection, causing a 1-frame caret jump

**Severity:** Low
**Location:** `CodeEditor.tsx:224-232` (`applyResult`), also `:391-397`, `:977-982`.

**Problem.** After programmatic edits (auto-pair, Tab, slash insert, AI replace, paste), selection is restored on the **next** animation frame because the new value must flush to the DOM first. This creates a perceptible one-frame caret flicker/jump on these operations and is fragile if multiple edits queue.

**Fix.** With a controlled textarea this is hard to avoid cleanly. EDITOR-00 resolves it: CM6 edits + selection are a single atomic transaction (`view.dispatch({ changes, selection })`), no rAF needed.

**Effort:** Low (as part of EDITOR-00).

---

### EDITOR-05 — 🔵 Per-keystroke `content.split("\n")` + cache bookkeeping on the hot path

**Severity:** Low
**Location:** `CodeEditor.tsx:215` (`lines` memo), `:610-638` (highlight cache build, prune, FIFO evict).

**Problem.** Every keystroke re-splits the whole document and walks all lines to build `highlightedLines`, plus runs a `Set` build and conditional prune. The cache makes per-line *highlight* work cheap, but the O(N) array build + Set + prune still runs each keystroke. Fine for small/medium docs; adds up on very large ones.

**Fix.** Solved by EDITOR-00. If kept: only rebuild the changed line(s) and reuse the prior array.

**Effort:** Low (as part of EDITOR-00).

---

## 5. Live preview performance findings

### PREVIEW-01 — 🔴 `react-markdown` re-parses + re-renders the entire document every 80 ms

**Severity:** Critical
**Location:** `MarkdownPreview.tsx:739-747` (`<Markdown>`), fed `deferredContent` from `App.tsx:201` (`useDebouncedValue(content, 80)`).

**Problem.** `react-markdown` has **no incremental parsing**. Each debounce tick re-runs the full pipeline over the *whole* document: remark parse → gfm → math → rehype → highlight → fresh element tree → full reconcile of `.markdown-body`. Editing line 5,000 re-parses lines 1–4,999. The 80 ms debounce only *coalesces* keystrokes; once it fires, the work is **synchronous on the main thread and blocks paint**. During sustained typing the preview is effectively always one full-parse behind — this is the "live view lags behind what I type."

**Fix (in order of impact).**
1. **Wrap the render in React 19 `startTransition`** so the heavy reconcile is interruptible and never blocks the keystroke that triggered it:
   ```tsx
   const [deferredBody, setDeferredBody] = useState(renderBody);
   useEffect(() => {
     startTransition(() => setDeferredBody(renderBody));
   }, [renderBody]);
   // render <Markdown>{deferredBody}</Markdown>
   ```
2. Move highlighting off the pipeline (PREVIEW-02).
3. For large docs, **block-level memoization**: split the doc into top-level blocks (by blank lines / headings), memoize each block's rendered output keyed by source text, re-render only changed blocks. (Bigger change; the only way to make 5k-line editing feel instant in-preview.)
4. **Scale the debounce with doc size** (80 ms small → ~250 ms for >2k lines).

**Effort:** (1) is ~1–2 hrs and the biggest perceived win. (3) is a half-to-full day.

---

### PREVIEW-02 — 🟠 highlight.js runs synchronous language auto-detection on every code block, every tick

**Severity:** High
**Location:** `MarkdownPreview.tsx:673-676` (`rehypePlugins` includes `rehypeHighlight`), applied `:743`.

**Problem.** `rehype-highlight` (highlight.js) tokenizes **every** code block synchronously during each render. With no `subset` configured it attempts **auto-detection across the full language set** for untagged fences — markedly more expensive than a known language — and repeats it for all blocks every tick, including unchanged ones. Cost is unbounded (a pasted 2,000-line log dominates the frame budget).

**Fix.**
- Pass an explicit language subset and disable broad auto-detect:
  ```tsx
  import rehypeHighlight from "rehype-highlight";
  // ...
  [rehypeHighlight, { detect: false, subset: ["js","ts","tsx","json","bash","python","rust","go","html","css","md"] }]
  ```
- **Better:** drop `rehype-highlight` from the react-markdown pipeline entirely and highlight lazily inside the `CodeBlock` component via `requestIdleCallback` after mount (mirrors how Mermaid is already handled at `MarkdownPreview.tsx:239-241`). Then highlighting never blocks the markdown reconcile and only runs for blocks actually in the tree.
- Skip highlighting for code blocks above some size (render as plain `<code>`).

**Effort:** Subset config ~30 min; lazy per-block ~half day.

---

### PREVIEW-03 — 🟠 Mermaid diagrams can re-render from scratch on unrelated edits; no source cache; no theme re-render

**Severity:** High
**Location:** `MermaidBlock.tsx:27,36` (module-global incrementing id), `:38-53` (effect on `[code]`), `:6-19` (one-time init), `:21-25` (`getMermaidTheme`).

**Problem.** `MermaidBlock`'s effect depends on `[code]`, which is correct in isolation. But because PREVIEW-01 rebuilds the entire element tree each tick, react-markdown can fail to positionally match `MermaidBlock` instances when blocks above change height — remounting them. Each remount with the same `code` calls `mermaid.render()` again (full SVG layout; mermaid core ~580 kB), because the id comes from an ever-incrementing global (`:27,36`) with **no `code → svg` cache**. So typing *anywhere* in a diagram-containing doc can re-render diagrams you aren't editing. Separately, `mermaid.initialize` runs once for the app's lifetime, so **switching light/dark theme does not re-theme existing diagrams**.

**Fix.**
- Add a module-level `Map<string, string>` cache (`code → svg`) — mirror `LOCAL_IMAGE_CACHE` at `MarkdownPreview.tsx:94-118`.
- `React.memo` the block; derive the id from a hash of `code` so identical sources are no-ops.
- Include the active theme in the cache key and re-render on theme change.

**Effort:** ~2–3 hrs.

---

### PREVIEW-04 — 🟡 Scroll sync isn't rAF-throttled and forces reflow on every scroll event

**Severity:** Medium
**Location:** `MarkdownPreview.tsx:679-705` (`handleScroll`), `CodeEditor.tsx:553-572` (`handleTextareaScroll`), `scrollSync.ts`.

**Problem.** Both scroll handlers fire on the raw `scroll` event (no rAF coalescing) and read `scrollHeight`/`clientHeight` (`MarkdownPreview.tsx:684`, `CodeEditor.tsx:565`) — layout-read properties that force synchronous reflow. The other side then writes `scrollTop`, dirtying layout for the next read → read-after-write thrash, worst on long docs (the same docs already slow to render). The feedback loop itself is correctly guarded by an 80 ms ignore window (`scrollSync.ts:34-43`), so this is **jank, not a loop**. Note: the editor's *overlay* `scrollTop` mirror at `CodeEditor.tsx:557-563` is intentionally synchronous for caret alignment and should stay so — only the cross-pane fraction notify needs throttling.

**Fix.** rAF-throttle the cross-pane `onScrollFraction` notify; cache `scrollHeight`/`clientHeight` and re-measure on `ResizeObserver`/content-change rather than per scroll event.

**Effort:** ~2 hrs.

---

### PREVIEW-05 — 🟡 Fraction→line scroll mapping assumes uniform line heights

**Severity:** Medium
**Location:** `MarkdownPreview.tsx:688` — `Math.max(1, Math.ceil(fraction * lineCount))`; consumed by status bar (`App.tsx:1130`) and TOC active line (`App.tsx:1123`).

**Problem.** Mapping scroll fraction to a line by `fraction × lineCount` assumes every line is the same height. In the rendered preview, headings, images, code blocks, tables, and math have wildly different heights, so the reported "current line" — and the editor↔preview scroll alignment — drift, especially in image/code-heavy docs.

**Fix.** Anchor sync to **content landmarks**: tag rendered block elements with their source line (`data-source-line`) and sync by nearest-heading/nearest-block rather than raw fraction. This also improves TOC accuracy.

**Effort:** ~half day.

---

### PREVIEW-06 — 🔵 `components` map churns because `handleTaskToggle` depends on `content`

**Severity:** Low–Medium
**Location:** `MarkdownPreview.tsx:496-519` (`handleTaskToggle`), `:521-625` (`components` useMemo, dep includes `handleTaskToggle`).

**Problem.** `handleTaskToggle` closes over `content`, so it's recreated on every content change, which recreates the `components` object, which makes react-markdown treat **every** custom renderer as new → forces a full re-render of every node type. It doesn't add a *new* re-render today (PREVIEW-01 already re-renders everything), but it **blocks** the block-level memoization fix in PREVIEW-01.3 from ever working.

**Fix.** Read `content` via a ref inside `handleTaskToggle` so the callback is stable; hoist the stateless renderers (`h1..h6`, `pre`) to module scope. Also `handleTaskToggle` does a full `content.split("\n")` + fence-aware scan per toggle (`:496-519`) — fine on click, O(n) on huge docs; derive the checkbox index from `node.position` instead of a render-order counter (`:615-624,634`) to drop the fragile global counter.

**Effort:** ~2 hrs.

---

## 6. AI feature findings

> **Correction to a common misdiagnosis:** `getAIConfig()` returns an **object** `{endpoint:"",model:"",apiKey:""}` (`persistence.ts:81-85`), which is **always truthy**. So the guard `{aiConfig && aiBubble && ...}` (`CodeEditor.tsx:1080`) does **not** gate on configuration — the bubble opens whenever `aiBubble` is set. The feature is wired correctly; the problem is purely discovery + the Windows shortcut.

### AI-01 — 🔴 No visible affordance to open AI assist (it's keyboard-only)

**Severity:** Critical (this is your "no button / can't open it" complaint)
**Location:** trigger only at `CodeEditor.tsx:266-280` (Alt+J / Ctrl+J in textarea `onKeyDown`); no entry point in `TitleBar`, `FormatToolbar`, `StatusBar`, `SlashMenu`, or the command palette (`App.tsx:779-951` has no AI item).

**Problem.** The only way to open the bubble is a keyboard chord. A normal user has no way to discover the feature exists.

**Fix.**
- Add an **AI button to `FormatToolbar`** (icon `auto_awesome`) that opens the bubble on the current selection. (Note the toolbar itself defaults OFF — `persistence.ts:71` — so also do the next item.)
- Add an **"AI assist on selection"** command to the command palette (`App.tsx` palette items), with the platform-correct shortcut hint, gated on `hasFile`.
- Consider a small inline affordance (e.g. a floating "✨" when text is selected).

**Effort:** ~1–2 hrs. This is the cheapest, highest-satisfaction fix in the whole audit.

---

### AI-02 — 🔴 Ctrl+J is swallowed by WebView2 (Windows); users never reach Alt+J

**Severity:** Critical (Windows)
**Location:** `CodeEditor.tsx:261-265` (comment documents the WebView2 Downloads grab), `:266-268` (Alt+J alias), `App.tsx:749-761` (capture-phase Ctrl+J block, which can't help on WebView2).

**Problem.** On Windows, WebView2 intercepts Ctrl+J for its Downloads UI before the page sees the keydown, so the page can't `preventDefault`. The working binding is **Alt+J**, but nothing tells the user that. Result on Win10/11: pressing Ctrl+J does nothing → "the feature is broken."

**Immediate workaround for you, today:** focus the editor, select text, press **Alt+J**. (Unconfigured AI will open the bubble and show "AI endpoint not configured.")

**Fix.** Once AI-01 adds a button, the shortcut stops being the only path. Also surface the platform shortcut in Settings → AI and the cheatsheet's AI section, and prefer Alt+J as the *documented* Windows binding.

**Effort:** Covered by AI-01 + AI-04.

---

### AI-03 — 🟠 Unconfigured AI fails silently-ish (error only appears after a click inside the bubble)

**Severity:** High
**Location:** `aiAssist.ts:58-62` (errors thrown only when an action runs), surfaced in `AIBubble.tsx:133-137`.

**Problem.** With no endpoint configured, the bubble opens but the helpful message ("Open Settings → AI to set one up") only appears **after** the user clicks an action. The first-run experience is opaque.

**Fix.** When the trigger fires and `aiConfig.endpoint` is empty, show a **toast** ("Configure AI in Settings → AI to enable AI assist") instead of (or before) opening the bubble. Optionally open Settings directly.

**Effort:** ~1 hr.

---

### AI-04 — 🟡 Settings → AI lacks status, validation for empty config, and a connection test

**Severity:** Medium
**Location:** `SettingsModal.tsx` AI section (`isValidEndpoint` check fires only for non-empty bad URLs), `aiAssist.ts:43-50` (`isValidEndpoint`).

**Problem.** A user can save an all-blank or partial config and think AI is ready. No "✓ Ready / ⚠ Not configured" indicator, no "Test connection" button. Error text on failure is technical (`aiAssist.ts:104` dumps `AI request failed (401): <body>`).

**Fix.** Add a status badge (Ready / Not configured / Invalid endpoint), a "Test connection" button (small request to the endpoint), and friendlier mapped errors (401/403 → "API key invalid", 5xx → "Service unavailable"). Surface the Alt+J/⌘+J shortcut here.

**Effort:** ~half day.

---

### AI-05 — ⚪ Data-flow transparency (see SECURITY-03)

The AI client sends selected text to a user-configured arbitrary endpoint. This is by design but deserves a clear in-UI notice — tracked as SECURITY-03.

---

## 7. Security findings

> Threat model: this is a **local desktop** Markdown editor. The primary adversary is a malicious `.md` file on disk, not a remote attacker. Severities are calibrated accordingly. Overall posture is **good**; items below are improvements, not active exploits.

### SECURITY-01 — 🟡 AI API key stored in plaintext localStorage

**Severity:** Medium
**Location:** `persistence.ts:78-90` (`KEY_AI_API_KEY`, `getAIConfig`/`setAIConfig`).

**Problem.** The key is stored unencrypted in localStorage, readable by any same-origin script and by anyone with access to the user profile on disk. Acceptable-with-disclosure for a local app, but not ideal.

**Fix.** Move the key to the OS keychain via a Tauri command using the `keyring` crate (Windows Credential Manager / macOS Keychain / Linux Secret Service). Keep a clear disclosure in Settings for the interim.

**Effort:** ~half day (new Rust command + front-end migration).

---

### SECURITY-02 — 🟡 `fs` capability scope is wide open (`{"path":"**"}`)

**Severity:** Medium
**Location:** `src-tauri/capabilities/default.json` — `fs:allow-read` and `fs:scope` use `"**"`.

**Problem.** Grants read access to any path. **Not currently exploitable** — no command takes an arbitrary untrusted path, and the front end validates relative paths (`MarkdownPreview.tsx` `isUnsafeRelativePath`, `commands.rs` `sanitize_image_name`). But it's a landmine: any future command that forwards a user/markdown-supplied path inherits read-anything.

**Fix.** Scope to `$HOME`, `$DOCUMENT`, and the app temp dir, or rely on the explicit dialog-driven flow. Add a CONTRIBUTING/CLAUDE.md note: "new Tauri commands must not accept arbitrary paths from untrusted input."

**Effort:** ~1–2 hrs (plus testing that legitimate open-anywhere still works).

---

### SECURITY-03 — ⚪ AI assist sends document text to a user-configured endpoint (by design)

**Severity:** Info / user education
**Location:** `aiAssist.ts:73-89` (POST selected text + system prompt to `cfg.endpoint`); CSP `connect-src` allows `https:` + localhost (`tauri.conf.json`).

**Problem.** Selected text leaves the machine to whatever endpoint the user configures. This is the intended feature, and the CSP correctly permits it. The risk is users not realizing their content is transmitted.

**Fix.** Add a prominent notice in Settings → AI ("Selected text is sent unencrypted to the endpoint you configure. For private notes, use a local endpoint such as Ollama."). Optionally a one-time acknowledgment.

**Effort:** ~1 hr.

---

### SECURITY-04 — 🔵 Mermaid SVG injected via `dangerouslySetInnerHTML` (mitigated)

**Severity:** Low
**Location:** `MermaidBlock.tsx` (`dangerouslySetInnerHTML={{ __html: svg }}`), init `securityLevel:"strict"` (`:12`).

**Problem.** Rendered SVG is injected into the DOM. A future Mermaid XSS could execute via a crafted diagram in a malicious `.md`.

**Mitigation present:** `securityLevel:"strict"` + CSP `script-src 'self'`.

**Fix.** Keep Mermaid (`^11.14.0`) and KaTeX (`^0.16.45`) updated; monitor advisories. No immediate action.

**Effort:** Ongoing (dependency hygiene).

---

### SECURITY-05 — 🔵 Symlinks are followed by default in file reads

**Severity:** Low
**Location:** `src-tauri/src/commands.rs` (uses `tokio::fs` which follows symlinks).

**Problem.** A symlink in the user's folder pointing at a sensitive file would be read if referenced. Low probability (requires attacker-created symlink + user opening a crafted doc; front-end `..` guards block traversal).

**Fix (optional):** reject symlinks in `read_file` via `symlink_metadata(...).is_symlink()`.

**Effort:** ~1 hr.

---

### SECURITY — ✅ Verified good (no action)

- **CSP** is tight and correct: `default-src 'self'`, `script-src 'self'`, `object-src 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, with `connect-src` allowing `https:` + localhost for AI, `img-src 'self' blob: data:`, `font-src 'self' data:` (`tauri.conf.json`). The only `'unsafe-inline'` is on `style-src`, which is required for React/Tailwind and acceptable.
- **File-size caps** enforced via stat-before-read: 50 MB text, 25 MB image (`commands.rs`).
- **Image sanitization** rejects path separators + non-whitelisted extensions, with unit tests (`commands.rs`).
- **Path-traversal guard** `isUnsafeRelativePath` rejects absolute paths, drive letters, `..` segments, NUL bytes (`MarkdownPreview.tsx`).
- **No devtools in release**, no obvious debug leftovers.
- **No `rehype-raw`/`dangerouslySetInnerHTML` on user markdown** — raw HTML in `.md` is not executed; only Mermaid's own SVG is injected (SECURITY-04).
- Dependency versions are current (Tauri 2, react-markdown 10, mermaid 11, katex 0.16).

---

## 8. UI/UX & accessibility findings

### UX-01 — 🟠 Focus is not restored to the trigger when dialogs close; focus-trap usage is inconsistent

**Severity:** High (accessibility)
**Location:** `SettingsModal.tsx`, `CommandPalette.tsx`, `ShortcutCheatsheet.tsx`, `UnsavedChangesDialog.tsx`; `src/utils/focusTrap.ts`.

**Problem.** Auto-focus on open is inconsistent (some focus an input, some nothing), and **none restore focus to the element that opened the dialog** on close — keyboard/screen-reader users lose their place. `attachFocusTrap` is used by SettingsModal/CommandPalette/Cheatsheet but UnsavedChangesDialog hand-rolls its own trap.

**Fix.** Extract one `<Modal>` primitive (UX-02) that: stores the trigger element, auto-focuses the first sensible control on open, restores focus on close, and uses a single focus-trap implementation.

**Effort:** ~half day (with UX-02).

---

### UX-02 — 🟡 Modal/dialog patterns diverge (z-index, width, max-height, backdrop, `aria-modal`)

**Severity:** Medium
**Location:** `SettingsModal.tsx`, `CommandPalette.tsx`, `ShortcutCheatsheet.tsx`, `UnsavedChangesDialog.tsx`, `StatsDialog.tsx`, `AIBubble.tsx`.

**Problem.** Dialogs use varying z-indexes (100 vs 110), widths, max-heights, backdrop-blur presence, backdrop-click-to-close behavior, and `aria-modal` presence. AIBubble lacks `aria-modal`. Inconsistent feel + accessibility gaps.

**Fix.** Single `<Modal>` wrapper: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, standardized backdrop + z-index + sizing + Esc-to-close + focus management. Apply everywhere.

**Effort:** ~half day.

---

### UX-03 — 🟡 Several power features are keyboard-only / under-discoverable

**Severity:** Medium
**Location:** AI (AI-01), cheatsheet only reachable via `?` or palette (`App.tsx:927-934`), various shortcuts.

**Problem.** Beyond AI, discoverability leans heavily on the cheatsheet and command palette, which new users may not find.

**Fix.** Ensure every feature has at least one visible affordance or a palette entry; add an AI section to the cheatsheet; consider a first-run tip.

**Effort:** ~2–3 hrs.

---

### UX-04 — 🔵 Minor accessibility nits

**Severity:** Low
**Location:** `StatusBar.tsx` (`div` with `aria-label` for save status → use `role="status"`/semantic element), `AIBubble.tsx:97-98` (add `aria-modal`), dialogs lacking visible "Esc to close" hints (only CommandPalette/Cheatsheet show one).

**Fix.** Use semantic elements/`role="status"`; add `aria-modal`; add an "Esc to close" footer hint to all dialogs (consistent with `ShortcutCheatsheet`).

**Effort:** ~2 hrs.

---

### UX-05 — 🔵 Visual consistency: button sizing varies by context

**Severity:** Low
**Location:** `FormatToolbar.tsx` (`w-8 h-8`), `TitleBar.tsx` (`w-8 h-8` / `w-7 h-7`), `StatusBar.tsx` (`w-8 h-6`).

**Fix.** Introduce a `<ToolButton size="sm|md">` and document intended sizes per surface (toolbar/header/footer).

**Effort:** ~2 hrs.

---

### UX-06 — 🔵 No loading/skeleton state during first markdown render of large files

**Severity:** Low
**Location:** `App.tsx:1085` (`Suspense fallback={null}`), preview first paint.

**Fix.** A subtle skeleton or progress hint while a large doc's preview renders.

**Effort:** ~1–2 hrs.

---

### UX — ✅ Verified good

- Reduced-motion respected globally (`index.css:314-324`).
- Visible keyboard focus ring via `:focus-visible` (`index.css:299-311`).
- Documented WCAG AA contrast fix in Paper theme (`index.css:112`).
- Four cohesive themes with consistent token structure.

---

## 9. Code quality, testing & build findings

### QUALITY-01 — 🟠 Zero front-end automated tests

**Severity:** High (process)
**Location:** `package.json` (no `test` script); only `*.test.*` files are in `node_modules`. Rust has unit tests (`commands.rs`); the **React side has none**.

**Problem.** The editor/cursor/scroll logic that keeps regressing has **no regression net**. The merge-then-revert history (`#36`, `#37`, the typing-flip revert `8e1fbfb`→`30c0d54`) is exactly what shipping without tests looks like.

**Fix.** Add **Vitest + React Testing Library** for unit/logic tests (editorActions, smartPaste, frontmatter, persistence, scrollSync) and a **Playwright/WebdriverIO** smoke test that types into the editor and asserts (a) caret/selection offsets and (b) input-to-paint latency budget. Wire into CI (`.github/workflows/ci.yml`). See [Appendix C](#appendix-c--testing-strategy).

**Effort:** ~1 day to stand up + initial coverage.

---

### QUALITY-02 — 🔵 `vite.config.ts` manualChunks omit the heaviest deps

**Severity:** Low
**Location:** `vite.config.ts` (manualChunks names only react + the markdown trio).

**Problem.** mermaid (~580 kB), katex+mhchem (~280 kB), jspdf, turndown aren't in `manualChunks`. They're split anyway via dynamic `import()`, so it's **not a cold-start bug**, but highlight.js rides in the eager `markdown` chunk (loads on first file open) and a shared transitive util could hoist into the eager path.

**Fix.** Add explicit chunks for mermaid and katex; split highlight.js out of the eager chunk (pairs with PREVIEW-02's lazy highlighting). Verify with `rollup-plugin-visualizer`.

**Effort:** ~2 hrs.

---

### QUALITY-03 — 🔵 `fonts.ts` eagerly registers ~30 font faces at startup

**Severity:** Low
**Location:** `src/fonts.ts:17-96`, imported from `main.tsx` before `index.css`.

**Problem.** Six body families × weights + Material Symbols + JetBrains Mono all register at module load, though most users use one body font + mono. Inflates cold-start CSS parse and bundle (woff2 are local, so no network, but the registration is eager).

**Fix.** Eagerly load only the default body font + JetBrains Mono (mono is needed early for caret alignment — keep its `document.fonts.load`); lazy-import alternate families' CSS when selected in Settings → Appearance.

**Effort:** ~2 hrs.

---

### QUALITY-04 — 🔵 Many active branches / churn around the same areas

**Severity:** Info
**Location:** git branches (`perf/instant-typing-feedback`, `perf/typing-latency`, `perf/render-and-bundle-optimization*`, `fix/revert-typing-flip-scroll-sync`, etc.).

**Problem.** Heavy branching and reverts concentrated on typing/scroll/cursor — symptomatic of the architectural ceiling (EDITOR-00) and the missing test net (QUALITY-01).

**Fix.** Land EDITOR-00 + QUALITY-01, then prune stale perf branches.

**Effort:** Process.

---

## 10. Remediation roadmap

Sequenced for impact-per-effort. P0 delivers visible wins fast; P1 is the structural fix; P2 is hardening/polish.

### P0 — quick, high-impact (target: a few hours each)

| Order | ID(s) | Action | Why first | Effort |
|---|---|---|---|---|
| 1 | AI-01, AI-02, AI-03 | Add AI button (toolbar + command palette), unconfigured-toast, document Alt+J | Fixes your #1 "AI is broken" complaint outright | ~2–3 hrs |
| 2 | PREVIEW-01 (#1), PREVIEW-02 | Wrap markdown render in `startTransition`; restrict highlight.js `subset` / disable auto-detect | Kills most "live view lags" with low risk | ~half day |
| 3 | PREVIEW-03 | Mermaid `code→svg` cache + `memo` | Stops unrelated edits re-rendering diagrams | ~2–3 hrs |
| 4 | — | **Decision gate:** commit to EDITOR-00 (CM6) vs. band-aids | Determines the shape of P1 | meeting |

### P1 — the structural fix (target: ~1–2 focused days)

| Order | ID(s) | Action | Effort |
|---|---|---|---|
| 5 | EDITOR-00 | Migrate editor to CodeMirror 6; re-implement gutter, wrap, typewriter, slash menu, AI anchor, find/replace, scroll sync, theme | ~1–2 days |
| 6 | CURSOR-01..03, EDITOR-01..05 | Verified resolved by EDITOR-00 (close them out via tests) | included |
| 7 | PREVIEW-04, PREVIEW-05 | rAF-throttle scroll sync; anchor sync to source-line landmarks | ~1 day |
| 8 | QUALITY-01 | Stand up Vitest + RTL + a Playwright caret/latency smoke test in CI | ~1 day |

> If the EDITOR-00 decision is "defer," replace step 5 with the interim editor mitigations (CURSOR-01 fix (2), EDITOR-01 wrap-virtualization, EDITOR-02 gutter virtualization) — more total effort, partial results.

### P2 — hardening & polish

| ID(s) | Action | Effort |
|---|---|---|
| SECURITY-01 | Move AI key to OS keychain (`keyring` crate) | ~half day |
| SECURITY-02 | Tighten `fs` capability scope + document the rule | ~2 hrs |
| SECURITY-03, AI-04 | AI data-flow notice + Settings status/test/friendly errors | ~half day |
| UX-01, UX-02 | Extract shared `<Modal>` (focus trap + restore + `aria-modal` + Esc hint) | ~half day |
| UX-03, UX-04, UX-05, UX-06 | Discoverability, a11y nits, button sizing, loading states | ~1 day |
| PREVIEW-06 | Stabilize `handleTaskToggle`/`components`; index checkboxes by `node.position` | ~2 hrs |
| QUALITY-02, QUALITY-03 | manualChunks for mermaid/katex; lazy alternate fonts | ~half day |
| SECURITY-04, SECURITY-05 | Dependency hygiene; optional symlink rejection | ongoing / ~1 hr |
| PREVIEW-01 (#3) | Block-level preview memoization for very large docs | ~half–1 day |

---

## Appendix A — file inventory

```
src/
  App.tsx                      App shell, state, keyboard shortcuts, layout, debounced preview
  main.tsx                     React root; imports fonts.ts then index.css
  index.css                    Theme tokens (4 themes), editor overlay CSS, scrollbar, markdown-body
  fonts.ts                     Eager @fontsource + Material Symbols registration
  context/ThemeContext.tsx     Theme provider
  components/
    CodeEditor.tsx             ⚠ Textarea+overlay editor (root cause; EDITOR-00..05, CURSOR-01..03)
    MarkdownPreview.tsx        ⚠ react-markdown pipeline (PREVIEW-01..06)
    MermaidBlock.tsx           ⚠ Mermaid render (PREVIEW-03, SECURITY-04)
    AIBubble.tsx               AI bubble UI (AI-01..03, UX-04)
    CommandPalette.tsx         Palette (AI-01: missing AI entry; UX-01/02)
    SettingsModal.tsx          Settings incl. AI config (AI-04, SECURITY-01/03, UX-01/02)
    FormatToolbar.tsx          Formatting toolbar (AI-01: add button; UX-05) — defaults OFF
    SlashMenu.tsx              "/" command menu
    FindReplaceBar.tsx         Find/replace
    TitleBar.tsx StatusBar.tsx ModeToggle.tsx SplitDivider.tsx Toast.tsx
    FileExplorer.tsx TableOfContents.tsx StatsDialog.tsx ShortcutCheatsheet.tsx
    UnsavedChangesDialog.tsx ErrorBoundary.tsx WelcomeScreen.tsx ExportMenu.tsx SettingsMenu.tsx
  utils/
    aiAssist.ts                AI client (AI-03, SECURITY-03)
    scrollSync.ts              Cross-pane fraction sync (PREVIEW-04)
    persistence.ts             localStorage incl. AI config (SECURITY-01; defaults)
    editorActions.ts smartPaste.ts imageUtils.ts exportUtils.ts
    documentStats.ts frontmatter.ts focusTrap.ts
src-tauri/
  src/commands.rs              File IO, size caps, image sanitization (+ tests) (SECURITY-02/05)
  src/lib.rs src/main.rs build.rs
  tauri.conf.json              CSP (good), window config
  capabilities/default.json    ⚠ fs scope "**" (SECURITY-02)
  Cargo.toml
vite.config.ts                 Code-split config (QUALITY-02)
.github/workflows/ci.yml release.yml
```

---

## Appendix B — how to verify each reported bug

- **Typing latency (EDITOR-00/01):** open a 2,000+ line `.md`, ensure word-wrap is ON (default), type rapidly mid-document. Observe the glyph trailing the caret. Compare with wrap OFF + a <300-line file (should feel fine). Confirms overlay-render-bound latency.
- **Cursor drift (CURSOR-01):** with wrap ON, create several very long lines (no spaces, e.g. a long URL or `aaaa...`), scroll down, click into lower lines — caret lands off the glyph. Toggle wrap OFF; drift should largely disappear (isolates wrap mismatch).
- **Cursor drift (CURSOR-02):** set Windows display scaling to 150%, repeat with a long doc; vertical drift accumulates downward.
- **Preview lag (PREVIEW-01/02):** split view, a doc with several large code fences, type continuously; preview stays a beat behind. Add `?` for a doc with no code blocks — lag drops (isolates highlight cost).
- **AI "can't open" (AI-01/02):** Windows, editor focused, select text → **Ctrl+J does nothing** (WebView2). Press **Alt+J** → bubble appears. Confirms it's discoverability, not breakage.

---

## Appendix C — testing strategy

**Unit (Vitest):** `editorActions` (tab/enter/auto-pair/backspace/wrap/link offsets), `smartPaste` (URL/TSV/HTML rules), `frontmatter` (parse/serialize round-trip), `persistence` (defaults, safeGet/safeSet), `scrollSync` (ignore-window, no feedback), `aiAssist` (endpoint validation, error mapping, timeout/abort), `documentStats`.

**Component (RTL):** AIBubble action filtering by selection; CommandPalette filtering; SettingsModal AI validation states; dialog focus-trap + restore (post UX-01/02).

**E2E (Playwright/WebdriverIO against the Tauri webview):**
- *Caret integrity:* type a known string, assert `selectionStart`/`selectionEnd` and that the rendered glyph box aligns with the caret coordinate (guards CURSOR-01..03 after EDITOR-00).
- *Latency budget:* measure input-event→paint on a large fixture; fail if median > target (guards EDITOR-00/01, PREVIEW-01).
- *AI discoverability:* assert a visible AI control exists and opens the bubble (guards AI-01).
- *Scroll sync:* drive editor scroll, assert preview tracks within tolerance (guards PREVIEW-04/05).

**CI:** run unit + component on every PR (fast); run E2E on PR-to-main. Add a bundle-size check (QUALITY-02).

---

*End of audit. Reference findings by ID in commits/PRs (e.g. `fix(AI-01): add toolbar + palette entry`). When a finding is resolved, check it off here and link the PR so this file stays the living record.*
