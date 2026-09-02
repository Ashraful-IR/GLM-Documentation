import type { Heading, Root, RootContent } from "mdast";
import type { DetectionStrategy } from "./types";
import type { DetectedSection, SplitResult } from "../types";
import { computeContentSummary, extractRawMarkdownFromNodes, getHeadingText, slugify } from "../utils";

// Regex matching HTTP method patterns like:
// ### 3.1. `GET /campaign/campaign-type` — Get Campaign Types
// ### GET /api/v1/users - List Users
// ## POST /auth/login: User Login
const ENDPOINT_REGEX =
  /^(?:[\d.]+\s*)?`?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+([^\s`]+)`?\s*(?:[—–\-:]\s*(.+))?$/i;

interface MatchedHeading {
  index: number;
  node: Heading;
  depth: number;
  text: string;
  method?: string;
  route?: string;
  isEndpoint: boolean;
  cleanTitle: string;
}

export class PatternHeadingStrategy implements DetectionStrategy {
  name = "PatternHeadingStrategy";

  canHandle(ast: Root): boolean {
    const headings = this.extractHeadings(ast);
    const endpointHeadings = headings.filter((h) => h.isEndpoint);
    // Fires if there are at least 2 endpoint patterns detected
    return endpointHeadings.length >= 2;
  }

  split(ast: Root, _rawMarkdown: string, filename: string): SplitResult {
    const children = ast.children;
    const headings = this.extractHeadings(ast);

    // Determine H1 or file name as suggested folder title
    let folderTitle = filename.replace(/\.(md|markdown)$/i, "");
    const h1 = headings.find((h) => h.depth === 1);
    if (h1) {
      folderTitle = h1.cleanTitle.replace(/^#+\s*/, "").trim();
    } else {
      // Capitalize/clean filename (e.g. Campaign-Service-Documentation -> Campaign Service Documentation)
      folderTitle = folderTitle.replace(/[-_]+/g, " ");
    }

    // Determine the common endpoint depth
    const endpointHeadings = headings.filter((h) => h.isEndpoint);
    const primaryDepth = endpointHeadings[0]?.depth ?? 3;

    // Collect sections
    const sections: DetectedSection[] = [];
    const referenceSections: DetectedSection[] = [];
    const warnings: string[] = [];

    // Identify key section headings (endpoints and high-level reference headings)
    const keyHeadings = headings.filter(
      (h) => h.isEndpoint || (h.depth <= primaryDepth && h.depth > 1)
    );

    // Identify sections by walking keyHeadings
    for (let i = 0; i < keyHeadings.length; i++) {
      const current = keyHeadings[i];
      const next = keyHeadings[i + 1];

      // Extract all children between current key heading and next key heading (or end of document)
      const startIdx = current.index;
      const endIdx = next ? next.index : children.length;
      const sectionNodes = children.slice(startIdx, endIdx);

      const summary = computeContentSummary(sectionNodes);
      const sectionMarkdown = extractRawMarkdownFromNodes(_rawMarkdown, sectionNodes);

      if (current.isEndpoint) {
        const title = current.text;
        const slug = slugify(
          current.route ? `${current.method}-${current.route}` : current.cleanTitle
        );

        sections.push({
          id: `sec-${sections.length + 1}`,
          title,
          slug,
          type: "CATALOG",
          method: current.method,
          route: current.route,
          headingDepth: current.depth,
          orderIndex: sections.length,
          rawMarkdown: sectionMarkdown,
          mdastNodes: sectionNodes,
          contentSummary: summary,
        });
      } else {
        // High-level reference sections (e.g., ## 1. System Overview, ## 5. Utilities)
        if (sectionNodes.length > 1) {
          const title = current.cleanTitle.replace(/^[\d.]+\s*/, "").trim();
          referenceSections.push({
            id: `ref-${referenceSections.length + 1}`,
            title,
            slug: slugify(title),
            type: "REFERENCE",
            headingDepth: current.depth,
            orderIndex: referenceSections.length,
            rawMarkdown: sectionMarkdown,
            mdastNodes: sectionNodes,
            contentSummary: summary,
          });
        }
      }
    }

    return {
      strategy: this.name,
      suggestedFolderTitle: folderTitle,
      suggestedFolderSlug: slugify(folderTitle),
      sections,
      referenceSections,
      warnings,
    };
  }

  private extractHeadings(ast: Root): MatchedHeading[] {
    const list: MatchedHeading[] = [];
    ast.children.forEach((child, index) => {
      if (child.type === "heading") {
        const heading = child as Heading;
        const text = getHeadingText(heading);
        const match = text.match(ENDPOINT_REGEX);

        if (match) {
          const method = match[1].toUpperCase();
          const route = match[2];
          const desc = match[3]?.trim();
          const cleanTitle = desc ? `${method} ${route} — ${desc}` : `${method} ${route}`;
          list.push({
            index,
            node: heading,
            depth: heading.depth,
            text,
            method,
            route,
            isEndpoint: true,
            cleanTitle,
          });
        } else {
          list.push({
            index,
            node: heading,
            depth: heading.depth,
            text,
            isEndpoint: false,
            cleanTitle: text,
          });
        }
      }
    });
    return list;
  }
}
