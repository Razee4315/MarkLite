<p align="center">
  <img src="public/icon.svg" width="80" alt="MarkLite Logo">
  <h1 align="center">MarkLite</h1>
</p>

<p align="center">
  <strong>A no-setup Markdown editor</strong>: open a file and write, with live preview, math, chemistry, and diagrams as you type, plus an optional free AI that proposes edits you accept or reject inline. Built with Tauri, React, and TypeScript.
</p>

<p align="center">
  <a href="https://github.com/Razee4315/MarkLite/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/Razee4315/MarkLite?color=2ea043&label=download"></a>
  <a href="https://github.com/Razee4315/MarkLite/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/Razee4315/MarkLite/total?color=2ea043"></a>
  <a href="https://github.com/Razee4315/MarkLite/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/Razee4315/MarkLite?style=flat"></a>
  <img alt="Platforms" src="https://img.shields.io/badge/platform-Windows%20%7C%20Linux-555">
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue"></a>
  <img alt="Built with Tauri" src="https://img.shields.io/badge/built%20with-Tauri%20%2B%20Rust-FFC131">
</p>

<p align="center">
  <a href="https://github.com/Razee4315/MarkLite/releases/latest"><b>⬇ Download</b></a> ·
  <a href="https://razee4315.github.io/MarkLite/"><b>Website</b></a> ·
  <a href="#features"><b>Features</b></a> ·
  <a href="CONTRIBUTING.md"><b>Contribute</b></a>
</p>

<p align="center">
  <img src="images/split-view.png" width="860" alt="MarkLite in split view — Markdown source on the left, live preview with a table, task list and callout on the right">
</p>

## Why MarkLite?

As a developer, I frequently work with markdown files for documentation, notes, and project READMEs. The frustration of opening `.md` files in Notepad or basic text editors, only to see raw, unformatted text with all the symbols and syntax cluttering the content, inspired me to build MarkLite.

I wanted something you just open and write in: it renders Markdown beautifully while keeping the raw text one keystroke away. Tools like Obsidian are powerful, but vaults, graphs, and plugins are overkill if you only want to open a file and edit it. MarkLite stays out of that complexity and adds the things I actually reach for: math and chemistry that render live, and an optional free AI (bring your own model) that proposes edits you accept or reject right in the text.

## Screenshots

**Math, chemistry, diagrams, and code — all rendered live as you type.**

<p align="center">
  <img src="images/showcase.png" width="860" alt="MarkLite preview rendering an integral equation, a balanced chemical reaction, a Mermaid flowchart, and a syntax-highlighted code block">
</p>

### Four themes

| Dark | Light |
|:----:|:-----:|
| <img src="images/theme-dark.png" width="420" alt="MarkLite Dark theme"> | <img src="images/theme-light.png" width="420" alt="MarkLite Light theme"> |
| **Paper** | **GitHub** |
| <img src="images/theme-paper.png" width="420" alt="MarkLite Paper theme"> | <img src="images/theme-github.png" width="420" alt="MarkLite GitHub theme"> |

### File explorer &amp; command palette

| File explorer | Command palette |
|:-------------:|:---------------:|
| <img src="images/file-explorer.png" width="420" alt="MarkLite file explorer with reader mode"> | <img src="images/command-palette.png" width="420" alt="MarkLite command palette"> |

## Features

### Writing

- **Clean Interface** — minimal UI that stays out of your way
- **Reader / Code / Split view** — Ctrl+E to toggle, Ctrl+\\ for split with bidirectional scroll sync
- **Focus mode** — dim non-active lines so you can think
- **Typewriter mode** — caret stays vertically centered
- **Formatting toolbar** (toggleable) and shortcuts: Ctrl+B / Ctrl+I / Ctrl+K / Ctrl+/
- **Slash commands** — type `/` at line start for headings, lists, tables, math, mermaid, callouts, and more
- **Auto-pair** brackets, quotes, and code marks; **list/quote continuation** on Enter
- **Tab in tables** moves between cells; auto-creates new rows
- **Visual table editing**: a toolbar appears when the caret is in a table, with buttons to add or delete rows and columns, set column alignment, and tidy the layout
- **Find & Replace** (Ctrl+F / Ctrl+H) with regex and match counter
- **Smart paste** — URL → link, rich HTML → markdown, TSV → GFM table

### Preview

- **GitHub Flavored Markdown** with task lists, tables, strikethrough
- **Code blocks** with syntax highlighting and one-click copy
- **Math** via KaTeX (`$inline$`, `$$block$$`) — loaded only when needed
- **Chemistry** via mhchem — `$\ce{2 H2 + O2 -> 2 H2O}$`, ions, isotopes, Kröger-Vink defects
- **Mermaid diagrams** (` ```mermaid `) — flowcharts, sequence, class, state, gantt, ER, mindmaps
- **Image lightbox** — click to zoom; lazy loading
- **Interactive task checkboxes** — toggling writes back to source
- **Heading anchors** with click-to-jump
- **Wikilinks** `[[other-file]]` resolve in the same folder
- **Frontmatter** rendered as an editable Properties card

### AI assistant

- **AI side panel** — open it from the **AI** button next to Export (or `Alt+J` / `⌘J`). A VS Code-style chat docked on the right; content reflows beside it.
- **Ask mode** — chat about the current document: summarize it, find something, ask questions. Answers stream in live.
- **Agent mode** — describe a change in plain language and the AI proposes edits. They appear as an **inline diff in the editor** (green added / red removed) which you **review and accept or reject** — per change, or all at once. Nothing is written until you approve.
- **Selection assist** — select text and press `Alt+J` / `⌘J` to rewrite, shorten, expand, continue, or translate it in place.
- **Bring your own model** — works with any OpenAI-compatible endpoint: OpenAI, Google Gemini (OpenAI-compat), Ollama, llama.cpp, and more. Configure it in **Settings → AI**; your API key is stored in the OS keychain.

### Files & workflow

- **Command palette** (Ctrl+P) — search commands, files, headings, toggles
- **Cheatsheet** (`?`) — every shortcut categorized and searchable
- **Settings modal** (Ctrl+,) — sidebar nav with Appearance / Editor / AI / About
- **New File** (Ctrl+N) and **Save As** (Ctrl+Shift+S)
- **Auto-save** (optional, debounced) with status indicator
- **External-change detection** — reload or keep your version when the file changes outside the app
- **Recent files** on the welcome screen — missing files marked
- **Restore last opened file** on launch
- **File Explorer** for the current folder
- **Outline pane** that follows the cursor

### Customization

- **Four themes** — Dark, Light, Paper, GitHub
- **Five fonts** — Inter, Merriweather, Lora, Source Serif, Fira Sans
- **Three font sizes**
- **WCAG-friendly** — visible focus rings, `prefers-reduced-motion` respected

### Platform

- **Native performance** — built with Tauri
- **Cross-platform** — Windows, macOS, Linux

## Installation

Download the latest release from the [Releases](https://github.com/Razee4315/MarkLite/releases) page.

### Available Formats

- **Windows**: `.msi` installer or `.exe` portable
- **Linux**: `.deb`, `.rpm`, or `.AppImage`

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- [Bun](https://bun.sh/) (recommended) or npm
- [Rust](https://www.rust-lang.org/tools/install)

### Setup

```bash
# Clone the repository
git clone https://github.com/Razee4315/MarkLite.git
cd MarkLite

# Install dependencies
bun install

# Run in development mode
bun run tauri dev

# Build for production
bun run tauri build
```

## Keyboard Shortcuts

A few essentials — press `?` inside the app for the full searchable list.

| Action | Shortcut |
|--------|----------|
| Command palette | Ctrl+P |
| Cheatsheet | ? |
| Settings | Ctrl+, |
| New file | Ctrl+N |
| Open file | Ctrl+O |
| Save | Ctrl+S |
| Save As | Ctrl+Shift+S |
| Toggle Reader / Code | Ctrl+E |
| Toggle Split view | Ctrl+\\ |
| File explorer / Outline | Ctrl+Shift+E / Ctrl+Shift+O |
| Find / Replace | Ctrl+F / Ctrl+H |
| Bold / Italic / Link | Ctrl+B / Ctrl+I / Ctrl+K |
| Toggle blockquote | Ctrl+/ |
| AI panel / assist | Alt+J (Windows) · ⌘J (macOS/Linux) |

## Tech Stack

- **Frontend**: React, TypeScript, Tailwind CSS
- **Backend**: Rust, Tauri v2
- **Build**: Vite

## Contributing

Contributions are very welcome — code, docs, bug reports, or ideas.

- 🌱 **New here?** Browse [`good first issue`](https://github.com/Razee4315/MarkLite/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) — small, scoped tasks to get started.
- 🗺️ See the [Roadmap](ROADMAP.md) for where MarkLite is headed and where help is wanted.
- 📦 Want to help with distribution? See [`packaging/`](packaging/) (winget, Scoop, and more).
- 📋 Please read the [Contributing Guidelines](CONTRIBUTING.md) and [Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request.

Even a ⭐ helps others discover the project.

## Author

**Saqlain Abbas**  
Email: saqlainrazee@gmail.com  
GitHub: [@Razee4315](https://github.com/Razee4315)
Linkedin: [@saqlain.razee](https://www.linkedin.com/in/saqlainrazee/)

## License

MarkLite is licensed under the **[Apache License 2.0](LICENSE)**: free to use, modify, and distribute for both personal and commercial purposes, with an explicit patent grant. Just keep the license and [NOTICE](NOTICE) with copies you redistribute.
