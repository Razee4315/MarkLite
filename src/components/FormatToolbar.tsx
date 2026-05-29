import type { EditorResult } from "../utils/editorActions";
import { wrapSelection, insertLink } from "../utils/editorActions";

interface FormatToolbarProps {
    /** Returns the textarea so we can read selection. Null while editor not mounted. */
    getTextarea: () => HTMLTextAreaElement | null;
    /** Apply an EditorResult: parent updates content + restores selection. */
    apply: (r: EditorResult) => void;
    /** Insert plain text at the caret. */
    insert: (text: string) => void;
    /** Open the AI assist bubble on the current selection. Renders an AI button
     *  when provided — the primary visible affordance for the AI feature
     *  (keyboard-only before; see AI-01 in AUDIT.md). */
    onAIAssist?: () => void;
}

interface ToolButtonProps {
    icon: string;
    title: string;
    onClick: () => void;
}

function ToolButton({ icon, title, onClick }: ToolButtonProps) {
    return (
        <button
            type="button"
            onMouseDown={(e) => e.preventDefault()} // keep textarea focus
            onClick={onClick}
            title={title}
            aria-label={title}
            className="w-8 h-8 flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors"
        >
            <span className="material-symbols-outlined text-[18px]">{icon}</span>
        </button>
    );
}

const Sep = () => <div className="w-px h-5 bg-[var(--border)] mx-0.5" />;

export function FormatToolbar({ getTextarea, apply, insert, onAIAssist }: FormatToolbarProps) {
    const wrap = (left: string, right: string, ph: string) => () => {
        const t = getTextarea();
        if (!t) return;
        apply(wrapSelection({ text: t.value, selStart: t.selectionStart, selEnd: t.selectionEnd }, left, right, ph));
    };

    const link = () => {
        const t = getTextarea();
        if (!t) return;
        apply(insertLink({ text: t.value, selStart: t.selectionStart, selEnd: t.selectionEnd }));
    };

    const heading = (level: number) => () => {
        const t = getTextarea();
        if (!t) return;
        const pos = t.selectionStart;
        const before = t.value.slice(0, pos);
        const ls = before.lastIndexOf("\n") + 1;
        const lineEnd = t.value.indexOf("\n", pos);
        const end = lineEnd === -1 ? t.value.length : lineEnd;
        const line = t.value.slice(ls, end);
        // Strip existing heading markers, then re-add
        const stripped = line.replace(/^#{1,6}\s+/, "");
        const newLine = `${"#".repeat(level)} ${stripped}`;
        apply({
            text: t.value.slice(0, ls) + newLine + t.value.slice(end),
            selStart: ls + newLine.length,
            selEnd: ls + newLine.length,
        });
    };

    const block = (prefix: string) => () => {
        const t = getTextarea();
        if (!t) return;
        const pos = t.selectionStart;
        const before = t.value.slice(0, pos);
        const ls = before.lastIndexOf("\n") + 1;
        const lineEnd = t.value.indexOf("\n", pos);
        const end = lineEnd === -1 ? t.value.length : lineEnd;
        const line = t.value.slice(ls, end);
        const newLine = line.startsWith(prefix) ? line.slice(prefix.length) : prefix + line;
        const delta = newLine.length - line.length;
        apply({
            text: t.value.slice(0, ls) + newLine + t.value.slice(end),
            selStart: pos + delta,
            selEnd: pos + delta,
        });
    };

    const codeBlock = () => {
        const t = getTextarea();
        if (!t) return;
        const sel = t.value.slice(t.selectionStart, t.selectionEnd) || "code";
        const inserted = `\n\`\`\`\n${sel}\n\`\`\`\n`;
        apply({
            text: t.value.slice(0, t.selectionStart) + inserted + t.value.slice(t.selectionEnd),
            selStart: t.selectionStart + 4, // place caret after opening fence
            selEnd: t.selectionStart + 4 + sel.length,
        });
    };

    const insertTable = () => {
        const tpl = "\n| Header 1 | Header 2 |\n| --- | --- |\n| Cell | Cell |\n";
        insert(tpl);
    };

    const insertHr = () => insert("\n\n---\n\n");

    return (
        <div className="flex items-center gap-0.5 px-2 h-9 bg-[var(--bg-secondary)] border-b border-[var(--border-subtle)] no-select shrink-0">
            <ToolButton icon="format_h1" title="Heading 1" onClick={heading(1)} />
            <ToolButton icon="format_h2" title="Heading 2" onClick={heading(2)} />
            <ToolButton icon="format_h3" title="Heading 3" onClick={heading(3)} />
            <Sep />
            <ToolButton icon="format_bold" title="Bold (Ctrl+B)" onClick={wrap("**", "**", "bold")} />
            <ToolButton icon="format_italic" title="Italic (Ctrl+I)" onClick={wrap("*", "*", "italic")} />
            <ToolButton icon="strikethrough_s" title="Strikethrough" onClick={wrap("~~", "~~", "text")} />
            <ToolButton icon="code" title="Inline code" onClick={wrap("`", "`", "code")} />
            <Sep />
            <ToolButton icon="format_list_bulleted" title="Bullet list" onClick={block("- ")} />
            <ToolButton icon="format_list_numbered" title="Numbered list" onClick={block("1. ")} />
            <ToolButton icon="check_box" title="Task list" onClick={block("- [ ] ")} />
            <ToolButton icon="format_quote" title="Blockquote (Ctrl+/)" onClick={block("> ")} />
            <Sep />
            <ToolButton icon="link" title="Link (Ctrl+K)" onClick={link} />
            <ToolButton icon="data_object" title="Code block" onClick={codeBlock} />
            <ToolButton icon="table_chart" title="Insert table" onClick={insertTable} />
            <ToolButton icon="horizontal_rule" title="Horizontal rule" onClick={insertHr} />
            {onAIAssist && (
                <>
                    <Sep />
                    <ToolButton icon="auto_awesome" title="AI assist (Alt+J)" onClick={onAIAssist} />
                </>
            )}
        </div>
    );
}
