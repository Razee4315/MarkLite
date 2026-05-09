# Changelog

All notable changes to MarkLite will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Improved — Cold start and runtime performance

- **Bundle main chunk: 1.08 MB → 282 kB (~74% smaller).** Welcome screen no
  longer ships the markdown rendering pipeline, jspdf/html2canvas, the
  command palette, settings, stats dialog, file explorer, outline panel,
  shortcuts cheatsheet, or the unsaved-changes dialog. Each is its own
  chunk, fetched the moment its surface mounts. `vite manualChunks`
  groups React and the markdown stack into stable vendor chunks the
  WebView2 disk cache can hold across upgrades.
- **First file open: instant.** A `requestIdleCallback` after the welcome
  screen settles starts the markdown chunk download in the background, so
  by the time the user opens a file the bundle is already in cache.
- **Typing path: less work per keystroke.** Command-palette heading scan
  no longer runs on every typing pause — only while the palette is
  actually open. App's per-keystroke `content.split("\n")` for
  `lineCount` moved into MarkdownPreview where it's actually used (one
  fewer full-document scan per keystroke). StatusBar, TitleBar,
  MarkdownPreview, and CodeEditor wrapped in `React.memo` with stable
  callbacks so caret-only re-renders bail out of reconciliation.
- **Highlight cache: drop LRU thrash.** The CodeEditor's per-line
  highlight cache used to do `delete + set` on every cached line per
  render to maintain LRU order — ~20 k Map mutations per keystroke on a
  10 k-line file. The pruning that actually mattered ("is this line
  still in the doc?") doesn't depend on order, so we just lookup-only on
  hit and let the rare hard-cap fallback evict FIFO.

### Added — Chemistry notation in math

- KaTeX now loads the **mhchem** contrib alongside the rest of the math
  bundle, so `\ce{...}` and `\pu{...}` render in the preview.
  This unlocks textbook-grade chemistry: balanced equations, ions,
  isotopes, oxidation states, arrows, and Kröger-Vink defect notation
  (e.g. `$\ce{2 Fe^x_{Fe} + O^x_{O} -> 2 Fe'_{Fe} + V_{O}^{**} + 1/2 O2 ^}$`).
  The math-detection regex now also picks up bare `\ce{` / `\pu{`,
  so chemistry-only documents trigger the lazy load even without
  `$` delimiters. New `/chem` slash command inserts a starter snippet.

### Improved — Book-style math typography

- Display equations are centered with proper vertical breathing room and
  scroll horizontally on narrow viewports instead of overflowing the
  reading column. KaTeX glyphs no longer inherit the global `code` border
  /background, and equation tags pick up the muted-text colour for a
  printed-textbook feel.

### Fixed — Caret drifts off the rendered glyph after scrolling

- The CodeEditor stacks a transparent `<textarea>` on top of a styled
  highlight overlay; alignment relies on both layers wrapping at the
  same column. Once the document grew past the viewport the textarea
  sprouted a vertical scrollbar that quietly ate ~10 px of its content
  area, while the overlay kept its full width. With word-wrap on, the
  two layers wrapped at different columns and the caret started landing
  a character or two off the rendered text after every scroll. Both
  layers now reserve a fixed scrollbar gutter (`scrollbar-gutter: stable`),
  and the overlay's own scrollbar is hidden visually so only the
  textarea's remains user-facing.

### Improved — Editor performance on large documents

- Typing into a 5 k+ line markdown file used to feel "sticky" because
  the highlight overlay mounted every line as a `<div>` and React's
  reconciler walked the lot on every keystroke. The overlay now
  virtualizes: only the lines visible in the viewport (plus a 40-line
  buffer) render, with fixed-height spacers above and below preserving
  scroll-height parity with the textarea so caret alignment is intact.
  Re-renders only fire when the visible window shifts by more than half
  the buffer, so smooth scrolling no longer thrashes setState.
  Word-wrap mode and small docs (under 400 lines) keep the previous
  full-render path. Per-line wrapper styles are also hoisted to module
  scope and the non-virtualized list is wrapped in `React.memo` so
  unchanged lines short-circuit prop diffing.

### Fixed — Webview accelerator collision

- AI assist shortcut now also responds to **Alt+J**. On Windows, WebView2
  treats `Ctrl+J` as a "browser accelerator" for the built-in Downloads
  UI — the page never sees the keydown, so `e.preventDefault()` can't
  rescue it. Alt+J skips that path entirely. macOS (WKWebView) and Linux
  (WebKitGTK) keep `Ctrl+J` working; the cheatsheet detects the platform
  and shows the right one. A capture-phase `keydown` listener also
  preventDefaults Ctrl+J app-wide, so on platforms where the page does
  see the event the host webview's default action is suppressed
  regardless of which element is focused.

### Fixed — Security

- `read_file` / `save_file` refuse documents above 50 MB. Stat happens before
  the read so an oversized file fails fast with a clear "File too large"
  toast instead of pulling hundreds of MB of UTF-8 into the webview while
  the UI freezes.
- `save_image` refuses payloads above 25 MB and now enforces an extension
  whitelist (`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `svg`,
  case-insensitive). A caller can no longer drop a `.exe` / `.dll` / `.lnk`
  into the user's documents folder under cover of the markdown image-paste
  flow. Tests cover the new rejections plus all whitelisted extensions.
- AI requests get a 60 s wall-clock timeout (composed with the user's
  existing `AbortController`) and the response is capped at 200 KB. A
  stuck local llama.cpp or a runaway model can no longer hang the AI
  bubble forever or paste megabytes of text into the editor.
- Tauri CSP further tightened: `object-src 'none'`, `base-uri 'self'`,
  `form-action 'none'`, `frame-ancestors 'none'`. Asset protocol disabled
  (it was scoped to `**` but the app loads images via plugin-fs + blob
  URLs and never touches `asset:`), and `asset:`/`https://asset.localhost`
  dropped from `default-src` and `img-src`.

### Added

- Status bar shows a "selected / total" word count when the editor has a
  non-empty selection; reverts to total when the selection collapses.
- Welcome screen: a Settings button next to Open/New, a "Clear all" link in
  the Recent header, and a visible drag highlight (dashed accent outline +
  hover background) so the drop target is obvious.

### Fixed — UX

- File-operation errors now surface the actual message from Rust
  ("File too large", "Image filename must end in …") instead of the
  generic "Failed to open file" / "Failed to save image. Please try again."
  toasts. Restore-on-launch surfaces TooLarge specifically so a user whose
  yesterday-doc grew above the cap gets an explanation instead of the
  editor silently opening to a blank welcome screen.
- Welcome screen: per-row Remove button on a Recent file used to be a
  `<span role="button">` nested inside the row's `<button>`. That's invalid
  HTML and could double-fire — clicking Remove sometimes also reopened the
  file. Split into two sibling buttons.

### Removed

- Dead `localStorage` helpers `getFocusMode` / `setFocusMode` /
  `getAutoSave` / `setAutoSave`. Both features were retired in 0.6.1 and
  nothing reads these keys anymore.

### Changed — Offline support

- All UI fonts (Inter, JetBrains Mono, Merriweather, Lora, Source Serif 4,
  Fira Sans) and the Material Symbols Outlined icon font are now bundled
  with the app via `@fontsource/*` and `material-symbols`. The
  `<link rel="stylesheet" href="https://fonts.googleapis.com/...">`
  tags have been removed from `index.html`, so the editor renders identically
  online and offline — no more "icon shows as text" while waiting for the CDN
  on a slow connection.
- Tauri CSP tightened: `style-src` no longer whitelists
  `https://fonts.googleapis.com` and `font-src` no longer whitelists
  `https://fonts.gstatic.com`. Fonts may now load only from `self` (the
  bundled woff2 files) plus `data:` URLs (used by some embedded SVG icons).
- HTML export drops the Google Fonts `@import`. The export now relies on
  font-family fallbacks (system sans/serif/mono) so exporting succeeds
  offline and the resulting file renders predictably anywhere.

### Added

- Word wrap toggle for the editor (Settings → Editor; default on). Wrapped
  mode hides the line-number gutter so per-source-line numbers don't drift
  out of alignment with wrapped visual rows.
- Spell check toggle for the editor (Settings → Editor; default off).
- Document statistics dialog (command palette → "Show document statistics"):
  words, characters, sentences, paragraphs, headings, links, images, code
  blocks, and reading time. Frontmatter and code blocks are excluded from
  prose counts.
- Command palette: "Reveal in folder" and "Copy file path" actions for the
  current file.

### Fixed — Security

- Wikilink resolver now rejects targets containing `..`, path separators,
  drive letters, or NUL bytes. A crafted document can no longer load files
  outside the current folder.
- Rust `save_image` command sanitizes the supplied filename to a bare
  basename, preventing escape from the `images/` subdirectory. Backed by
  unit tests covering common traversal payloads.
- External markdown links (`http(s)://`, `mailto:`) now open in the system
  default handler via `tauri-plugin-opener` instead of navigating the
  webview itself; `rel="noopener noreferrer"` is also set as a fallback.
- AI assist refuses non-`http(s)` endpoints; the Settings modal flags an
  invalid endpoint inline so users get fast feedback before triggering a
  request.
- Settings modal makes it explicit that the AI API key is stored
  unencrypted in localStorage.

### Fixed — UX

- AI assist bubble repositions when it would overflow the right or bottom
  edge of the viewport, flipping above the anchor when there is no room
  below.

## [0.6.1] - 2026-04-30

### Fixed

- "This file was deleted or moved" banner appearing on every opened file (false positive in mtime polling) — feature removed
- Outline panel: scrolling broken and last item bleeding into status bar (missing `flex flex-col` + `min-h-0` chain on the panel)
- TOC links inside markdown body (e.g. `[Q1](#q1)`) not navigating to their headings — explicit click handler added with fuzzy heading-text fallback for non-matching slugs
- New File button doing nothing visible — `hasFile` now considers a blank `Untitled.md` buffer as "open"
- Command palette on the welcome screen exposing Save / Save As / view toggles that wouldn't work without a buffer

### Removed

- Auto-save toggle (UI removed from Settings dropdown, Settings modal, command palette, status bar)
- Focus-mode dimming of non-active editor lines — all lines now render at full opacity (typewriter mode kept)
- External-change polling that was watching the open file's mtime

### Changed

- Wikilink resolution and recent-file existence checks use the existing `get_file_info` Rust command instead of the fs plugin's `stat`

## [0.6.0] - 2026-04-29

### Added — Editor

- Tab / Shift+Tab indent (multi-line aware)
- Auto-pair for `()`, `[]`, `{}`, `` ` ``, `""`, `''` — wraps selection or inserts pair, type-past closer, atomic backspace
- Enter continues lists, blockquotes, and task items
- Markdown formatting shortcuts: Ctrl+B / Ctrl+I / Ctrl+K / Ctrl+/
- Find & Replace (Ctrl+F / Ctrl+H) with regex, case-sensitive, match counter
- Slash commands `/` with 13 block transformations
- Smart paste: URL → link, plain URL → autolink, rich HTML → markdown (Turndown), TSV → GFM table
- Tab navigation inside markdown tables (skips separator, creates rows)
- Formatting toolbar above editor (toggleable)
- Focus mode (dim non-active lines)
- Typewriter mode (caret stays vertically centered)
- Active-line highlight in editor and gutter

### Added — Preview

- Code blocks have a hover-revealed Copy button
- Headings get GitHub-style stable slug IDs and clickable anchor links
- Click-to-zoom image lightbox
- Lazy image loading
- Interactive task checkboxes — toggling writes back to source
- KaTeX math rendering (`$inline$`, `$$block$$`) — lazy-loaded
- Mermaid diagrams (` ```mermaid `) — lazy-loaded
- YAML frontmatter parsed and rendered as a collapsible, editable Properties card
- Wikilinks `[[Foo]]` and `[[Foo|alias]]` clickable in preview

### Added — App

- Split view (Ctrl+\\) with draggable, keyboard-resizable divider
- Bidirectional scroll sync between editor and preview in split mode
- Restore last opened file on launch
- View mode and split ratio persist across sessions
- Recent files list on welcome screen with parent folder, time-ago, remove button; missing files struck through
- New File (Ctrl+N) and Save As (Ctrl+Shift+S)
- External-change detection — banner offers Reload/Keep mine when the file is modified outside MarkLite
- Auto-save toggle (1.5s debounce) with status chip in StatusBar
- Command palette (Ctrl+P) with fuzzy ranking — searches commands, files, headings, toggles
- Settings modal (Ctrl+,) with sidebar navigation and search
- Keyboard cheatsheet modal (`?`)
- Outline pane highlights the heading the cursor is in; filter input for large docs
- AI assist scaffold (Ctrl+J) — Rewrite / Shorten / Expand / Continue / Translate via configurable OpenAI-compatible endpoint (Ollama, llama.cpp, OpenAI, etc.)
- Reading time and character count in StatusBar

### Fixed

- Caret no longer drifts vertically between the textarea and syntax-highlight overlay (font metric alignment, empty-line rendering, rAF-driven scroll sync)
- Paper theme `--text-muted` darkened to pass WCAG AA contrast
- Sidebar panels (FileExplorer, TableOfContents) now trap focus
- Toast errors announce as `role="alert"` / `aria-live="assertive"`
- `prefers-reduced-motion` is respected globally

### Changed

- Visible focus rings on all interactive elements (keyboard focus only)
- Design tokens for radius and spacing in `:root`
- StatusBar replaces inert "UTF-8" with icons next to word count and reading time
- TitleBar shows a hint when no file is open
- Welcome screen lists New File alongside Open File and surfaces Ctrl+P / `?` hints

### Removed

- The hidden off-screen markdown renderer used for export — capture happens directly from the visible preview now

## [0.5.1] - 2026-01-XX

### Added

- Error boundary
- Unsaved-changes protection on close
- Loading state during file open

## [0.1.0] - 2025-01-01

### Added

- Initial release of MarkLite
- Clean markdown preview with live rendering
- Code editor with syntax highlighting
- Three themes: Dark, Light, and Paper
- Five font options: Inter, Merriweather, Lora, Source Serif, Fira Sans
- Three font sizes: Small, Medium, Large
- Keyboard shortcuts (Ctrl+O, Ctrl+S, Ctrl+E)
- Cross-platform support (Windows, macOS, Linux)
- Custom titlebar with window controls
- Settings menu for theme and font customization
- Drag and drop support for markdown files
- Auto-save indicator in status bar
