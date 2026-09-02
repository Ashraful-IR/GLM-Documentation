import type { Heading, Root } from "mdast";
import type { DetectionStrategy } from "./types";
import type { SplitResult } from "../types";
import { computeContentSummary, getHeadingText, slugify } from "../utils";

export class SingleDocumentFallback implements DetectionStrategy {
  name = "SingleDocumentFallback";

  canHandle(): boolean {
    return true; // Always can handle as ultimate fallback
  }

  split(ast: Root, _rawMarkdown: string, filename: string): SplitResult {
    const children = ast.children;

    let title = filename.replace(/\.(md|markdown)$/i, "");
    const h1 = children.find((c) => c.type === "heading" && (c as Heading).depth === 1) as
      | Heading
      | undefined;

    if (h1) {
      title = getHeadingText(h1).replace(/^#+\s*/, "").trim();
    } else {
      title = title.replace(/[-_]+/g, " ");
    }

    const summary = computeContentSummary(children);
    const slug = slugify(title);

    return {
      strategy: this.name,
      suggestedFolderTitle: title,
      suggestedFolderSlug: slug,
      sections: [
        {
          id: "sec-1",
          title,
          slug,
          type: "DOCUMENT",
          headingDepth: 1,
          orderIndex: 0,
          rawMarkdown: _rawMarkdown,
          mdastNodes: children,
          contentSummary: summary,
        },
      ],
      referenceSections: [],
      warnings: ["No repeating catalog pattern detected. Imported as a single document."],
    };
  }
}
