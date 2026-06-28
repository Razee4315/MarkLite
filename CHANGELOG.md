# Changelog

All notable changes to Paperling will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Multiple tabs.** Open several files at once. Opening a file (or following a
  link) opens it in a new tab instead of replacing what you're reading; a tab bar
  appears once a second file is open. `Ctrl+N` opens a new tab, `Ctrl+W` closes
  one, middle-click closes too, and unsaved tabs prompt before closing.

## [1.0.42] - 2026-06-28

## [1.0.41] - 2026-06-28

### Added

- **Search across files** (`Ctrl+Shift+F`). Search the text of every markdown
  file in the current folder, grouped by file with line numbers; pick a result
  to jump straight to that line. Also in the command palette.
- **`[[` autocomplete.** Typing `[[` in the editor now suggests the other
  markdown files in the folder, so linking is a couple of keystrokes.
- **Create missing notes.** Clicking a `[[link]]` or relative link to a file
  that doesn't exist yet offers to create it and opens the new note.

## [1.0.40] - 2026-06-28

### Added

- **Link navigation with history.** Clicking a `[[wikilink]]` or a standard
  relative `[text](note.md)` link now opens that file in-app. Back and forward
  buttons (and `Alt+←` / `Alt+→`) move through the files you've visited, and
  opening a file now starts you at the top instead of the previous scroll spot.

## [1.0.39] - 2026-06-28

## [1.0.38] - 2026-06-28

### Added

- **Word (.docx) export.** Export → Word writes a real Office Open XML document
  from the current file, with headings, lists, tables, bold/italic, links, and
  images carried over. Like PDF, it's a clean light document for sharing.

## [1.0.37] - 2026-06-28

## [1.0.36] - 2026-06-28

## [1.0.35] - 2026-06-22

### Added

- The Export and Settings dropdown menus are now fully keyboard-operable: focus
  moves into the menu on open, Arrow/Home/End move between items, and Escape
  closes and returns focus to the button.
- The file explorer refreshes when the window regains focus and gained a manual
  refresh button, so its list no longer goes stale after files change on disk.

### Changed

- **PDF export now saves directly.** On Windows, "Export → PDF" asks where to
  save and writes the file straight away, instead of opening the system print
  dialog. The PDF keeps selectable text and working links.
- The theme now matches your operating system's light/dark setting on first
  launch, and follows it until you pick a theme yourself.
- Notifications stack instead of replacing one another, and error messages stay
  on screen longer than confirmations.
- The Light theme has a softer, warmer tone for a bit more character.

### Removed

- The GitHub theme. (Light covers the same clean, bright look.)

### Fixed

- Find & Replace now shows "Invalid pattern" for an unparseable regex instead of
  a misleading "No results".
- Cancelling the export save dialog no longer shows a false "Exported" message.
- A persistent autosave failure keeps reminding you (throttled) instead of
  going quiet after the first warning.

## [1.0.34] - 2026-06-22

## [1.0.33] - 2026-06-18

## [1.0.32] - 2026-06-18

## [1.0.31] - 2026-06-18

## [1.0.30] - 2026-06-18

### Changed

- The "What's new" update popup now shows a concise summary of just the latest
  release's changes, instead of the full changelog history.

## [1.0.29] - 2026-06-18

### Added

- **Fullscreen mode (F11)** for distraction-free writing on Windows, Linux, and
  macOS. The title bar stays visible so there is always an obvious way out, with
  a one-time hint. Also available from the command palette.
- **Automatic updates.** Paperling checks for new versions on launch and offers
  a one-click update when a newer version is available. Update packages are
  signed and verified before installing.
- **Enable AI toggle** (Settings → AI). Turning AI off hides every AI surface:
  the title-bar button, the side panel, the toolbar sparkle, Alt+J, and the
  command palette entry.
- **Visual table editor.** A floating toolbar appears inside a Markdown table to
  insert or delete rows and columns, set per-column alignment, and re-align the
  layout.
- **Chemistry notation in math.** KaTeX now renders `\ce{...}` and `\pu{...}`
  (mhchem), with a `/chem` slash command to insert a starter snippet.
- **Document statistics** dialog — words, characters, sentences, paragraphs,
  headings, links, images, code blocks, and reading time.
- **Word wrap** and **spell check** toggles in Settings → Editor.
- **Selected word count** in the status bar, plus command-palette actions to
  reveal the current file in its folder and copy its path.

### Changed

- **Relicensed to Apache 2.0** — free for personal and commercial use, with an
  explicit patent grant.
- **Works fully offline.** All fonts and the icon set are now bundled, so the
  editor looks identical online and offline, and HTML export no longer depends
  on Google Fonts.
- **Book-style math typography** — display equations are centered with proper
  spacing and scroll horizontally on narrow screens instead of overflowing.

### Fixed

- List bullets and numbers render in the preview again.
- Ctrl+S / Ctrl+O / Ctrl+N / Ctrl+E now work with CapsLock on.
- Clicking a heading's anchor link copies a section link and confirms with a
  checkmark.
- Alt+J reliably opens the AI panel on Windows, where WebView2 had reserved
  Ctrl+J for its Downloads UI.
- The caret no longer drifts off the text after scrolling large documents.
- Clearer file-operation error messages (for example "File too large") instead
  of generic failures.
- Security hardening across file, image, AI, and wikilink handling: size limits,
  filename and path-traversal sanitizing, an AI request timeout and response
  cap, and a tightened Content Security Policy.

### Removed

- Retired dead auto-save / focus-mode storage helpers left over from 0.6.1.

### Performance

- Faster cold start and a much smaller initial bundle — the welcome screen no
  longer loads the markdown, export, or dialog code until it is needed — plus
  smoother typing and scrolling on large documents.

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
