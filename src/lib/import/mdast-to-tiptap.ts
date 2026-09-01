/**
 * mdast → Tiptap JSON mapper (ADR-3).
 *
 * Pure, deterministic function that walks a standard mdast tree (produced by
 * remark-parse + remark-gfm) and maps it node-for-node onto the platform's
 * Tiptap JSON schema.  No headless editor required.
 *
 * Nodes with no Tiptap equivalent degrade to a plain codeBlock — never dropped.
 */

import type { TiptapNode } from "@/db/schema";

// We use `any` for the mdast node type because remark's union types are
// complex and we're just doing a simple structural walk.  This keeps the
// mapping code readable and avoids verbose type narrowing at every branch.
/* eslint-disable @typescript-eslint/no-explicit-any */
type MdastNode = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Inline marks ────────────────────────────────────────────────────────

function mapInlineNodes(
  nodes: MdastNode[] | undefined,
): TiptapNode[] | undefined {
  if (!nodes || nodes.length === 0) return undefined;
  const out: TiptapNode[] = [];
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        out.push({ type: "text", text: node.value ?? "" });
        break;
      case "strong":
        out.push({
          type: "text",
          text: collectText(node),
          marks: [{ type: "bold" }],
        });
        break;
      case "emphasis":
        out.push({
          type: "text",
          text: collectText(node),
          marks: [{ type: "italic" }],
        });
        break;
      case "inlineCode":
        out.push({
          type: "text",
          text: node.value ?? "",
          marks: [{ type: "code" }],
        });
        break;
      case "delete":
        out.push({
          type: "text",
          text: collectText(node),
          marks: [{ type: "strike" }],
        });
        break;
      case "link":
        out.push({
          type: "text",
          text: collectText(node),
          marks: [{ type: "link", attrs: { href: node.url ?? "", target: "_blank" } }],
        });
        break;
      case "image":
        out.push({
          type: "text",
          text: node.alt ?? "[image]",
          marks: node.url ? [{ type: "link", attrs: { href: node.url } }] : undefined,
        });
        break;
      case "html":
        out.push({ type: "text", text: node.value ?? "" });
        break;
      case "footnoteReference":
      case "footnoteDefinition":
        out.push({ type: "text", text: `[${node.type}: ${node.identifier ?? ""}]` });
        break;
      default:
        if (node.children?.length) {
          out.push(...(mapInlineNodes(node.children) ?? []));
        } else {
          out.push({ type: "text", text: node.value ?? "" });
        }
        break;
    }
  }
  return out;
}

function collectText(node: MdastNode): string {
  if (node.value) return node.value;
  if (node.children) return node.children.map(collectText).join("");
  return "";
}

// ── Block-level nodes ───────────────────────────────────────────────────

function mapBlockNode(node: MdastNode): TiptapNode | null {
  switch (node.type) {
    case "heading": {
      const level = node.depth ?? 1;
      return {
        type: "heading",
        attrs: { level },
        content: mapInlineNodes(node.children),
      };
    }

    case "paragraph":
      return {
        type: "paragraph",
        content: mapInlineNodes(node.children),
      };

    case "list": {
      const listType = node.ordered ? "orderedList" : "bulletList";
      return {
        type: listType,
        attrs: node.ordered && node.start != null && node.start !== 1 ? { start: node.start } : undefined,
        content: node.children?.map((child: MdastNode) => mapListItem(child)),
      };
    }

    case "listItem":
      return {
        type: "listItem",
        content: node.children
          ?.map((c: MdastNode) => mapBlockNode(c))
          .filter((n: TiptapNode | null): n is TiptapNode => n !== null),
      };

    case "blockquote":
      return {
        type: "blockquote",
        content: node.children
          ?.map((c: MdastNode) => mapBlockNode(c))
          .filter((n: TiptapNode | null): n is TiptapNode => n !== null),
      };

    case "code": {
      const attrs: Record<string, unknown> = {};
      if (node.lang) attrs.language = node.lang;
      return {
        type: "codeBlock",
        attrs,
        content: [{ type: "text", text: node.value ?? "" }],
      };
    }

    case "thematicBreak":
      return { type: "horizontalRule" };

    case "html":
      return {
        type: "codeBlock",
        attrs: { language: "html" },
        content: [{ type: "text", text: node.value ?? "" }],
      };

    case "table":
      return mapTable(node);

    case "definition":
      return {
        type: "paragraph",
        content: [{ type: "text", text: `[Definition: ${node.label ?? ""}]` }],
      };

    case "footnoteDefinition":
      return {
        type: "paragraph",
        content: [{ type: "text", text: `[Footnote ${node.identifier ?? ""}]` }],
      };

    case "containerDirective":
    case "leafDirective":
    case "mdxJsxFlowElement":
    case "mdxTextExpression":
    case "mdxJsxTextElement":
      return {
        type: "codeBlock",
        attrs: { language: node.type },
        content: [{ type: "text", text: node.value ?? "" }],
      };

    default:
      return {
        type: "codeBlock",
        content: [{ type: "text", text: node.value ?? "" }],
      };
  }
}

function mapListItem(node: MdastNode): TiptapNode {
  return {
    type: "listItem",
    content: node.children
      ?.map((c: MdastNode) => mapBlockNode(c))
      .filter((n: TiptapNode | null): n is TiptapNode => n !== null),
  };
}

// ── Table mapping ───────────────────────────────────────────────────────

function mapTable(tableNode: MdastNode): TiptapNode {
  const rows = tableNode.rows ?? [];
  const content = rows.map((row: MdastNode) => {
    const cells = row.children ?? [];
    return {
      type: "tableRow" as const,
      content: cells.map((cell: MdastNode) => {
        const cellType = cell.header ? "tableHeader" : "tableCell";
        return {
          type: cellType as "tableCell" | "tableHeader",
          content: cell.children
            ?.map((c: MdastNode) => mapBlockNode(c))
            .filter((n: TiptapNode | null): n is TiptapNode => n !== null),
        };
      }),
    };
  });
  return { type: "table", content };
}

// ── Public API ──────────────────────────────────────────────────────────

/**
 * Converts a root-level mdast AST (from remark-parse) into a Tiptap JSON
 * document.
 */
export function mdastToTiptap(mdastRoot: MdastNode): { type: "doc"; content: TiptapNode[] } {
  const children = mdastRoot.children ?? [];
  const content: TiptapNode[] = [];

  for (const child of children) {
    const mapped = mapBlockNode(child);
    if (mapped) content.push(mapped);
  }

  return { type: "doc", content };
}

/**
 * Converts a subtree (slice of mdast children) into a Tiptap document.
 * Used for individual detected sections that only have children, not a
 * root wrapper.
 */
export function mdastChildrenToTiptap(
  children: MdastNode[],
): { type: "doc"; content: TiptapNode[] } {
  const content: TiptapNode[] = [];
  for (const child of children) {
    const mapped = mapBlockNode(child);
    if (mapped) content.push(mapped);
  }
  return { type: "doc", content };
}
