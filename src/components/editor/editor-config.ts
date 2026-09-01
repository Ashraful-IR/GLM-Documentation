"use client";

import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { Placeholder } from "@tiptap/extension-placeholder";
import { Table, TableCell, TableHeader, TableRow } from "@tiptap/extension-table";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color, FontFamily, FontSize, TextStyle } from "@tiptap/extension-text-style";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";

import { CalloutExtension } from "./extensions/CalloutExtension";

const lowlight = createLowlight(common);

/**
 * One extension set for both the editor and the read-only viewer — this is
 * what keeps edit/view rendering identical (§6, §16).
 */
export function buildEditorExtensions(placeholder?: string): any[] {
  return [
    StarterKit.configure({
      codeBlock: false, // replaced by CodeBlockLowlight below
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      // Tiptap v3's StarterKit already ships link + underline.
      link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } },
    }),
    Image.configure({ inline: false }),
    Table.configure({ resizable: true }),
    TableRow,
    TableHeader,
    TableCell,
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    CodeBlockLowlight.configure({ lowlight }),
    CalloutExtension,
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}

/**
 * Shared document typography marker for the paper page in both edit and view
 * mode so toggling between them causes no layout shift (§16). The actual
 * element styles live in globals.css under `.document-body`.
 */
export const documentBodyClass = "document-body";
