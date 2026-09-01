"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import {
  AlertTriangle,
  AlignLeft,
  Bold,
  CheckSquare,
  Code2,
  FileCode2,
  Heading1,
  Heading2,
  Image as ImageIcon,
  Info,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageSquareQuote,
  Minus,
  Table2,
  Underline as UnderlineIcon,
} from "lucide-react";

interface SlashItem {
  title: string;
  hint?: string;
  keywords: string;
  icon: React.ReactNode;
  action: (editor: any) => void;
}

const ITEMS: SlashItem[] = [
  { title: "Heading 1", keywords: "h1 heading title", icon: <Heading1 className="size-4" />, action: (e) => (e.chain().focus() as any).toggleHeading({ level: 1 }).run() },
  { title: "Heading 2", keywords: "h2 heading", icon: <Heading2 className="size-4" />, action: (e) => (e.chain().focus() as any).toggleHeading({ level: 2 }).run() },
  { title: "Bullet list", keywords: "ul list bullets", icon: <List className="size-4" />, action: (e) => (e.chain().focus() as any).toggleBulletList().run() },
  { title: "Numbered list", keywords: "ol ordered list", icon: <ListOrdered className="size-4" />, action: (e) => (e.chain().focus() as any).toggleOrderedList().run() },
  { title: "Task list", keywords: "todo checkbox", icon: <CheckSquare className="size-4" />, action: (e) => (e.chain().focus() as any).toggleTaskList().run() },
  { title: "Quote", keywords: "blockquote quote", icon: <MessageSquareQuote className="size-4" />, action: (e) => (e.chain().focus() as any).toggleBlockquote().run() },
  { title: "Code block", keywords: "code pre", icon: <FileCode2 className="size-4" />, action: (e) => (e.chain().focus() as any).toggleCodeBlock().run() },
  { title: "Table", keywords: "table grid", icon: <Table2 className="size-4" />, action: (e) => (e.chain().focus() as any).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: "Divider", keywords: "hr rule divider", icon: <Minus className="size-4" />, action: (e) => (e.chain().focus() as any).setHorizontalRule().run() },
  { title: "Callout — info", keywords: "callout note info", icon: <Info className="size-4" />, action: (e) => (e.chain().focus() as any).setCallout("info").run() },
  { title: "Callout — warning", keywords: "callout warning", icon: <AlertTriangle className="size-4" />, action: (e) => (e.chain().focus() as any).setCallout("warning").run() },
  { title: "Bold", keywords: "bold", icon: <Bold className="size-4" />, action: (e) => (e.chain().focus() as any).toggleBold().run() },
  { title: "Italic", keywords: "italic", icon: <Italic className="size-4" />, action: (e) => (e.chain().focus() as any).toggleItalic().run() },
  { title: "Underline", keywords: "underline", icon: <UnderlineIcon className="size-4" />, action: (e) => (e.chain().focus() as any).toggleUnderline().run() },
  { title: "Inline code", keywords: "code inline", icon: <Code2 className="size-4" />, action: (e) => (e.chain().focus() as any).toggleCode().run() },
  { title: "Link", keywords: "link url", icon: <Link2 className="size-4" />, action: (e) => {
    const url = window.prompt("Link URL");
    if (url) (e.chain().focus() as any).setLink({ href: url }).run();
  } },
  { title: "Image", keywords: "image picture", icon: <ImageIcon className="size-4" />, action: (e) => {
    const url = window.prompt("Image URL");
    if (url) (e.chain().focus() as any).setImage({ src: url }).run();
  } },
  { title: "Align left", keywords: "align text", icon: <AlignLeft className="size-4" />, action: (e) => (e.chain().focus() as any).setTextAlign("left").run() },
];

/**
 * Lightweight slash-command: typing `/` at the start of a node opens the
 * menu; typing narrows it; Enter inserts the selected block. Implemented
 * without the suggestion plugin so it stays simple and predictable.
 */
export function SlashCommand({ editor }: { editor: any }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const filtered = ITEMS.filter(
    (i) => !query || i.title.toLowerCase().includes(query.toLowerCase()) || i.keywords.includes(query.toLowerCase()),
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open || !editor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelected((s) => (s + 1) % Math.max(filtered.length, 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelected((s) => (s - 1 + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = filtered[selected];
        if (item) {
          item.action(editor);
          close();
        }
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, editor, filtered, selected, close]);

  // Detect "/" at the start of the current text block.
  useEffect(() => {
    const handleUpdate = () => {
      if (!editor) return;
      const { state } = editor;
      const { $from } = state.selection;
      const textBefore = $from.parent.textBetween(0, $from.parentOffset, undefined, "\uFFFC");
      const match = textBefore.match(/^\/(\S*)$/);
      if (match) {
        const coords = editor.view.coordsAtPos(state.selection.from);
        setPosition({ top: coords.top, left: coords.left });
        setQuery(match[1]);
        setSelected(0);
        setOpen(true);
      } else {
        close();
      }
    };
    editor.on("update", handleUpdate);
    editor.on("selectionUpdate", handleUpdate);
    return () => {
      editor.off("update", handleUpdate);
      editor.off("selectionUpdate", handleUpdate);
    };
  }, [editor, close]);

  if (!open || filtered.length === 0) return null;

  return (
    <div
      ref={boxRef}
      className="fixed z-50 w-64 rounded-lg border bg-popover p-1.5 text-popover-foreground shadow-md"
      style={position ? { top: position.top + 8, left: Math.max(8, position.left) } : undefined}
    >
      <p className="px-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Insert</p>
      <div className="max-h-64 overflow-y-auto">
        {filtered.map((item, i) => (
          <button
            key={item.title}
            type="button"
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${i === selected ? "bg-accent" : ""}`}
            onMouseEnter={() => setSelected(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              item.action(editor);
              close();
            }}
          >
            <span className="text-muted-foreground">{item.icon}</span>
            <span className="flex-1 truncate">{item.title}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
