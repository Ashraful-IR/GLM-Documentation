import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root } from "mdast";

export function parseMarkdownToAst(markdown: string): Root {
  const processor = unified().use(remarkParse).use(remarkGfm);
  const ast = processor.parse(markdown);
  return ast as Root;
}
