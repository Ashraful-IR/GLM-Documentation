import type { Root } from "mdast";
import type { DetectionStrategy } from "./strategies/types";
import { PatternHeadingStrategy } from "./strategies/pattern-heading";
import { NumberedSubsectionStrategy } from "./strategies/numbered-heading";
import { SingleDocumentFallback } from "./strategies/single-document";
import type { SplitResult } from "./types";

export class SectionDetector {
  private strategies: DetectionStrategy[];

  constructor(strategies?: DetectionStrategy[]) {
    this.strategies = strategies ?? [
      new PatternHeadingStrategy(),
      new NumberedSubsectionStrategy(),
      new SingleDocumentFallback(),
    ];
  }

  detectAndSplit(ast: Root, rawMarkdown: string, filename: string): SplitResult {
    for (const strategy of this.strategies) {
      if (strategy.canHandle(ast, rawMarkdown)) {
        return strategy.split(ast, rawMarkdown, filename);
      }
    }
    // Fallback guaranteed
    return new SingleDocumentFallback().split(ast, rawMarkdown, filename);
  }
}
