import type { Heading, Root } from "mdast";
import type { DetectionStrategy } from "./types";
import type { DetectedSection, SplitResult } from "../types";
import { computeContentSummary, extractRawMarkdownFromNodes, getHeadingText, slugify } from "../utils";

const NUMBERED_REGEX = /^(?:§|\d+(?:\.\d+)*\.?)\s+(.+)$/;

export class NumberedSubsectionStrategy implements DetectionStrategy {
  name = "NumberedSubsectionStrategy";

  canHandle(ast: Root): boolean {
    const headings = this.extractHeadings(ast);
    // Group by depth
    const depthCounts = new Map<number, number>();
    headings.forEach((h) => {
      depthCounts.set(h.depth, (depthCounts.get(h.depth) ?? 0) + 1);
    });

    // Check if any heading depth >= 2 appears >= 3 times
    for (const [depth, count] of depthCounts.entries()) {
      if (depth >= 2 && count >= 3) {
        return true;
      }
    }
    return false;
  }

  split(ast: Root, _rawMarkdown: string, filename: string): SplitResult {
    const children = ast.children;
    const headings = this.extractHeadings(ast);

    // Determine target depth with highest frequency >= 2
    const depthCounts = new Map<number, number>();
    headings.forEach((h) => {
      if (h.depth >= 2) {
        depthCounts.set(h.depth, (depthCounts.get(h.depth) ?? 0) + 1);
      }
    });

    let targetDepth = 2;
    let maxCount = 0;
    for (const [depth, count] of depthCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        targetDepth = depth;
      }
    }

    // Determine H1 or file name as suggested folder title
    let folderTitle = filename.replace(/\.(md|markdown)$/i, "");
    const h1 = headings.find((h) => h.depth === 1);
    if (h1) {
      folderTitle = h1.text.replace(/^#+\s*/, "").trim();
    } else {
      folderTitle = folderTitle.replace(/[-_]+/g, " ");
    }

    const sections: DetectedSection[] = [];
    const referenceSections: DetectedSection[] = [];
    const targetHeadings = headings.filter((h) => h.depth === targetDepth);

    for (let i = 0; i < targetHeadings.length; i++) {
      const current = targetHeadings[i];
      const next = targetHeadings[i + 1];

      const startIdx = current.index;
      const endIdx = next ? next.index : children.length;
      const sectionNodes = children.slice(startIdx, endIdx);

      const summary = computeContentSummary(sectionNodes);
      const sectionMarkdown = extractRawMarkdownFromNodes(_rawMarkdown, sectionNodes);
      const title = current.text;
      const slug = slugify(title);

      sections.push({
        id: `sec-${sections.length + 1}`,
        title,
        slug,
        type: "CATALOG",
        headingDepth: current.depth,
        orderIndex: sections.length,
        rawMarkdown: sectionMarkdown,
        mdastNodes: sectionNodes,
        contentSummary: summary,
      });
    }

    // Capture preamble before first target heading as reference section if non-empty
    const firstTarget = targetHeadings[0];
    if (firstTarget && firstTarget.index > 0) {
      const preambleNodes = children.slice(0, firstTarget.index);
      if (preambleNodes.length > 0) {
        const summary = computeContentSummary(preambleNodes);
        const sectionMarkdown = extractRawMarkdownFromNodes(_rawMarkdown, preambleNodes);
        referenceSections.push({
          id: "ref-1",
          title: "Introduction",
          slug: "introduction",
          type: "REFERENCE",
          headingDepth: 1,
          orderIndex: 0,
          rawMarkdown: sectionMarkdown,
          mdastNodes: preambleNodes,
          contentSummary: summary,
        });
      }
    }

    return {
      strategy: this.name,
      suggestedFolderTitle: folderTitle,
      suggestedFolderSlug: slugify(folderTitle),
      sections,
      referenceSections,
      warnings: [],
    };
  }

  private extractHeadings(ast: Root): Array<{ index: number; depth: number; text: string }> {
    const list: Array<{ index: number; depth: number; text: string }> = [];
    ast.children.forEach((child, index) => {
      if (child.type === "heading") {
        const heading = child as Heading;
        const text = getHeadingText(heading);
        list.push({ index, depth: heading.depth, text });
      }
    });
    return list;
  }
}
