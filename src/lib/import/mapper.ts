import type {
  BlockContent,
  DefinitionContent,
  Heading,
  List,
  ListItem,
  PhrasingContent,
  Root,
  RootContent,
  Table,
  TableCell,
  TableRow,
} from "mdast";
import type { TiptapDocument, TiptapMark, TiptapNode } from "@/types/editor";

export function mdastToTiptap(nodes: RootContent[] | Root): TiptapDocument {
  const rootNodes = Array.isArray(nodes) ? nodes : nodes.children || [];
  const content: TiptapNode[] = [];

  for (const node of rootNodes) {
    const converted = mapBlockNode(node);
    if (converted) {
      if (Array.isArray(converted)) {
        content.push(...converted);
      } else {
        content.push(converted);
      }
    }
  }

  // Ensure document always has valid content
  if (content.length === 0) {
    content.push({ type: "paragraph" });
  }

  return {
    type: "doc",
    content,
  };
}

function mapBlockNode(
  node: RootContent | BlockContent | DefinitionContent
): TiptapNode | TiptapNode[] | null {
  switch (node.type) {
    case "heading": {
      const heading = node as Heading;
      const inlineContent = mapInlineNodes(heading.children);
      return {
        type: "heading",
        attrs: { level: Math.min(Math.max(heading.depth, 1), 6) },
        content: inlineContent.length > 0 ? inlineContent : undefined,
      };
    }

    case "paragraph": {
      const inlineContent = mapInlineNodes(node.children);
      return {
        type: "paragraph",
        content: inlineContent.length > 0 ? inlineContent : undefined,
      };
    }

    case "code": {
      return {
        type: "codeBlock",
        attrs: {
          language: node.lang || "plaintext",
        },
        content: node.value
          ? [
              {
                type: "text",
                text: node.value,
              },
            ]
          : undefined,
      };
    }

    case "blockquote": {
      const children: TiptapNode[] = [];
      for (const child of node.children) {
        const converted = mapBlockNode(child);
        if (converted) {
          if (Array.isArray(converted)) children.push(...converted);
          else children.push(converted);
        }
      }
      return {
        type: "blockquote",
        content: children.length > 0 ? children : [{ type: "paragraph" }],
      };
    }

    case "list": {
      const list = node as List;
      const listType = list.ordered ? "orderedList" : "bulletList";
      const items: TiptapNode[] = [];

      for (const child of list.children) {
        const item = mapListItem(child);
        if (item) items.push(item);
      }

      return {
        type: listType,
        attrs: list.ordered && typeof list.start === "number" ? { start: list.start } : undefined,
        content: items.length > 0 ? items : undefined,
      };
    }

    case "table": {
      return mapTable(node as Table);
    }

    case "thematicBreak": {
      return {
        type: "horizontalRule",
      };
    }

    case "html": {
      // Degrade raw HTML to a codeblock or paragraph safely
      return {
        type: "codeBlock",
        attrs: { language: "html" },
        content: [{ type: "text", text: node.value }],
      };
    }

    default:
      return null;
  }
}

function mapListItem(item: ListItem): TiptapNode {
  const content: TiptapNode[] = [];

  for (const child of item.children) {
    const converted = mapBlockNode(child);
    if (converted) {
      if (Array.isArray(converted)) content.push(...converted);
      else content.push(converted);
    }
  }

  if (content.length === 0) {
    content.push({ type: "paragraph" });
  }

  return {
    type: "listItem",
    content,
  };
}

function mapTable(table: Table): TiptapNode {
  const rows: TiptapNode[] = [];

  table.children.forEach((rowNode: TableRow, rowIndex: number) => {
    const cells: TiptapNode[] = [];
    const isHeaderRow = rowIndex === 0;

    rowNode.children.forEach((cellNode: TableCell) => {
      const cellType = isHeaderRow ? "tableHeader" : "tableCell";
      const inline = mapInlineNodes(cellNode.children);

      cells.push({
        type: cellType,
        content: [
          {
            type: "paragraph",
            content: inline.length > 0 ? inline : undefined,
          },
        ],
      });
    });

    if (cells.length > 0) {
      rows.push({
        type: "tableRow",
        content: cells,
      });
    }
  });

  return {
    type: "table",
    content: rows.length > 0 ? rows : undefined,
  };
}

function mapInlineNodes(
  nodes: PhrasingContent[],
  activeMarks: TiptapMark[] = []
): TiptapNode[] {
  const result: TiptapNode[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case "text": {
        if (node.value) {
          result.push({
            type: "text",
            text: node.value,
            marks: activeMarks.length > 0 ? [...activeMarks] : undefined,
          });
        }
        break;
      }

      case "inlineCode": {
        result.push({
          type: "text",
          text: node.value,
          marks: [...activeMarks, { type: "code" }],
        });
        break;
      }

      case "strong": {
        const boldMark: TiptapMark = { type: "bold" };
        result.push(...mapInlineNodes(node.children, [...activeMarks, boldMark]));
        break;
      }

      case "emphasis": {
        const italicMark: TiptapMark = { type: "italic" };
        result.push(...mapInlineNodes(node.children, [...activeMarks, italicMark]));
        break;
      }

      case "delete": {
        const strikeMark: TiptapMark = { type: "strike" };
        result.push(...mapInlineNodes(node.children, [...activeMarks, strikeMark]));
        break;
      }

      case "link": {
        const linkMark: TiptapMark = {
          type: "link",
          attrs: {
            href: node.url,
            title: node.title ?? undefined,
          },
        };
        result.push(...mapInlineNodes(node.children, [...activeMarks, linkMark]));
        break;
      }

      case "image": {
        result.push({
          type: "image",
          attrs: {
            src: node.url,
            alt: node.alt || "",
            title: node.title || undefined,
          },
        });
        break;
      }

      case "break": {
        result.push({
          type: "hardBreak",
        });
        break;
      }

      default:
        // Ignore or handle other inline nodes gracefully
        break;
    }
  }

  return result;
}
