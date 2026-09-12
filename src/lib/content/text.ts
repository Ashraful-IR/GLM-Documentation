import type { TiptapJson, TiptapNode } from "@/db/schema";

/**
 * Walks a Tiptap JSON document and extracts its plain text.
 * Block-level nodes are separated by newlines so headings and paragraphs
 * read naturally in search snippets and in the `content_text` column.
 */
export function extractTextFromDoc(doc: TiptapJson | null | undefined): string {
  if (!doc) return "";
  const parts: string[] = [];
  const walk = (nodes: TiptapNode[] | undefined, blockLevel: boolean) => {
    if (!nodes) return;
    for (const node of nodes) {
      if (node.type === "text") {
        parts.push(node.text ?? "");
        continue;
      }
      const isBlock = !["textStyle", "link", "bold", "italic", "underline", "strike", "code", "highlight", "color"].includes(
        node.type,
      );
      walk(node.content, isBlock);
      if (isBlock) parts.push("\n");
    }
  };
  walk(doc.content, true);
  return parts.join("").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Caps extracted text so the GIN full-text index can always build its
 * tsvector. PostgreSQL throws "string is too long for tsvector" (input cap:
 * 1MB) when `content_text` grows too large, which fails the entire document
 * save. Truncation bounds what is *searchable*, never what can be stored.
 *
 * Counts true UTF-8 bytes (CJK = 3 bytes/char, emoji = 4) so the cap holds
 * for any script, and cuts only on code-point boundaries.
 */
export function limitTextForIndex(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;

  let bytes = 0;
  let cut = 0;
  for (let i = 0; i < text.length; ) {
    const cp = text.codePointAt(i) as number;
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (bytes + size > maxBytes) break;
    bytes += size;
    i += cp > 0xffff ? 2 : 1;
    cut = i;
  }
  let sliced = text.slice(0, cut);
  // Avoid ending mid-word when the boundary splits a token.
  const lastSpace = sliced.lastIndexOf(" ");
  if (lastSpace > cut * 0.9) sliced = sliced.slice(0, lastSpace);
  return `${sliced.trimEnd()}…`;
}
