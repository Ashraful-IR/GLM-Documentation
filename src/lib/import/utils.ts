import type { Heading, PhrasingContent, RootContent } from "mdast";

export function getHeadingText(node: Heading): string {
  return extractTextFromPhrasing(node.children).trim();
}

export function extractTextFromPhrasing(nodes: PhrasingContent[]): string {
  let text = "";
  for (const child of nodes) {
    if ("value" in child && typeof child.value === "string") {
      text += child.value;
    } else if ("children" in child && Array.isArray(child.children)) {
      text += extractTextFromPhrasing(child.children as PhrasingContent[]);
    }
  }
  return text;
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Replace / and : with -
      .replace(/[\/:]+/g, "-")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "") || "doc"
  );
}

export function computeContentSummary(nodes: RootContent[]): {
  wordCount: number;
  tableCount: number;
  codeBlockCount: number;
} {
  let wordCount = 0;
  let tableCount = 0;
  let codeBlockCount = 0;

  for (const node of nodes) {
    if (node.type === "table") {
      tableCount++;
    } else if (node.type === "code") {
      codeBlockCount++;
      if (node.value) {
        wordCount += node.value.trim().split(/\s+/).filter(Boolean).length;
      }
    } else if (node.type === "paragraph" || node.type === "heading") {
      const text = extractTextFromPhrasing(node.children);
      wordCount += text.trim().split(/\s+/).filter(Boolean).length;
    }
  }

  return { wordCount, tableCount, codeBlockCount };
}

export function extractRawMarkdownFromNodes(
  rawMarkdown: string,
  nodes: RootContent[]
): string {
  if (!nodes || nodes.length === 0) return "";
  const first = nodes[0];
  const last = nodes[nodes.length - 1];

  if (
    first.position?.start?.offset !== undefined &&
    last.position?.end?.offset !== undefined
  ) {
    return rawMarkdown.slice(first.position.start.offset, last.position.end.offset).trim();
  }

  return "";
}
