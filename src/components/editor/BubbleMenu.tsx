"use client";

import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Italic,
  Link2,
  Strikethrough,
  Underline as UnderlineIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function MenuButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`size-7 ${active ? "bg-accent text-accent-foreground" : ""}`}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function EditorBubbleMenu({ editor }: { editor: Editor }) {
  return (
    <TiptapBubbleMenu editor={editor} updateDelay={100}>
      <TooltipProvider delayDuration={200}>
        {/* The editor paper hardcodes color:#18181b — without an explicit text
            color here the icons inherit black and vanish on the dark popover. */}
        <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
          <MenuButton label="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold className="size-3.5" />
          </MenuButton>
          <MenuButton label="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic className="size-3.5" />
          </MenuButton>
          <MenuButton label="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <UnderlineIcon className="size-3.5" />
          </MenuButton>
          <MenuButton label="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough className="size-3.5" />
          </MenuButton>
          <MenuButton label="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Code2 className="size-3.5" />
          </MenuButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <MenuButton label="Heading 1" active={editor.isActive("heading", { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 className="size-3.5" />
          </MenuButton>
          <MenuButton label="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 className="size-3.5" />
          </MenuButton>
          <Separator orientation="vertical" className="mx-1 h-5" />
          <MenuButton
            label={editor.isActive("link") ? "Remove link" : "Add link"}
            active={editor.isActive("link")}
            onClick={() => {
              if (editor.isActive("link")) {
                editor.chain().focus().unsetLink().run();
              } else {
                const url = window.prompt("Link URL");
                if (url) editor.chain().focus().setLink({ href: url }).run();
              }
            }}
          >
            <Link2 className="size-3.5" />
          </MenuButton>
        </div>
      </TooltipProvider>
    </TiptapBubbleMenu>
  );
}
