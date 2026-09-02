import { parseMarkdownToAst } from "./parser";
import { SectionDetector } from "./detector";
import { mdastToTiptap } from "./mapper";
import type { ImportPreviewResponse, SplitResult } from "./types";

export * from "./types";
export * from "./parser";
export * from "./mapper";
export * from "./detector";
export * from "./utils";

const detector = new SectionDetector();

export function analyzeMarkdown(
  rawMarkdown: string,
  filename: string
): { splitResult: SplitResult; preview: ImportPreviewResponse } {
  const ast = parseMarkdownToAst(rawMarkdown);
  const splitResult = detector.detectAndSplit(ast, rawMarkdown, filename);

  const preview: ImportPreviewResponse = {
    strategy: splitResult.strategy,
    suggestedFolderTitle: splitResult.suggestedFolderTitle,
    suggestedFolderSlug: splitResult.suggestedFolderSlug,
    sections: splitResult.sections.map((s) => ({
      id: s.id,
      title: s.title,
      slug: s.slug,
      type: s.type,
      method: s.method,
      route: s.route,
      orderIndex: s.orderIndex,
      rawMarkdown: s.rawMarkdown,
      contentSummary: s.contentSummary,
    })),
    referenceSections: splitResult.referenceSections.map((s) => ({
      id: s.id,
      title: s.title,
      slug: s.slug,
      type: s.type,
      method: s.method,
      route: s.route,
      orderIndex: s.orderIndex,
      rawMarkdown: s.rawMarkdown,
      contentSummary: s.contentSummary,
    })),
    warnings: splitResult.warnings,
  };

  return { splitResult, preview };
}
