/**
 * Section detection strategies (ADR-1).
 *
 * A chain of ordered heuristics that analyse a Markdown file's AST and split
 * it into individually-documented units.  The first strategy that yields a
 * confident split wins.
 *
 * Each strategy returns NormalisedSection[] — if nothing fires, the caller
 * wraps the whole file as a single document.
 */

import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";

import { mdastChildrenToTiptap } from "./mdast-to-tiptap";
import type { TiptapJson } from "@/db/schema";

// ── Public types ────────────────────────────────────────────────────────

export interface DetectedSection {
  title: string;
  slugHint: string;
  method?: string;
  route?: string;
  headingDepth: number;
  startLine: number;
  endLine: number;
  content: TiptapJson;
  orderIndex: number;
}

export interface DetectionResult {
  strategy: string;
  sections: DetectedSection[];
  referenceSections: DetectedSection[];
  warnings: string[];
}

// ── Helpers ─────────────────────────────────────────────────────────────

// Use `any` for mdast types since remark's union types are complex.
/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyNode = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    || "section";
}

function headingText(children: AnyNode[] | undefined): string {
  if (!children) return "";
  const parts: string[] = [];
  const walk = (nodes: AnyNode[]) => {
    for (const n of nodes) {
      if (n.type === "text") parts.push(n.value ?? "");
      else if (n.type === "inlineCode") parts.push(`\`${n.value ?? ""}\``);
      else if (n.type === "strong") parts.push(`**${(n.children ?? []).map((c: AnyNode) => c.value ?? "").join("")}**`);
      else if (n.type === "emphasis") parts.push(`*${(n.children ?? []).map((c: AnyNode) => c.value ?? "").join("")}*`);
      else if (n.type === "link") parts.push(`[${(n.children ?? []).map((c: AnyNode) => c.value ?? "").join("")}](${n.url ?? ""})`);
      else if (n.type === "image") parts.push(`![${n.alt ?? ""}](${n.url ?? ""})`);
      else if (n.type === "delete") parts.push(`~~${(n.children ?? []).map((c: AnyNode) => c.value ?? "").join("")}~~`);
      else if (n.children) walk(n.children);
    }
  };
  walk(children);
  return parts.join("");
}

// Precomputed at import time — the root of the empty file.
let _emptyRoot: AnyNode = null;
function emptyRoot(): AnyNode {
  if (!_emptyRoot) {
    _emptyRoot = unified().use(remarkParse).use(remarkGfm).parse("");
  }
  return _emptyRoot;
}

/**
 * Parse markdown to a full AST.  Returns the root node (with `position`
 * line info for every node).
 */
export function parseMarkdown(md: string): AnyNode {
  if (!md.trim()) return emptyRoot();
  return unified().use(remarkParse).use(remarkGfm).parse(md);
}

/**
 * Extract line number from an mdast node's position metadata.
 */
function startLine(node: AnyNode): number {
  return node?.position?.start?.line ?? 0;
}
function endLine(node: AnyNode): number {
  return node?.position?.end?.line ?? 0;
}

// ── Strategy 1: PatternHeadingStrategy ──────────────────────────────────

/**
 * Matches REST endpoint headings of the form:
 *   ### 3.1. `GET /campaign/campaign-type` — Get Campaign Types
 *
 * Also matches without the method:
 *   ### 3.1. Create a new user
 *
 * Generalises to any service doc that documents items at a consistent heading
 * depth.
 */
// Note: headingText() strips the leading `### ` markers, so the regex
// matches the TEXT content only (no `#` prefix).
const PATTERN_HEADING_RE =
  /^[\d.]+\s*\??\.?\s*`?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)\s+([^\s`]+)`?\s*[—–\-]?\s*(.+)$/i;

const PATTERN_HEADING_ALT_RE =
  /^[\d.]+\s*\??\.?\s*`?(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|CONNECT|TRACE)\s+([^\s`]+)`?\s*(?:—|–|-)\s*(.+)$/i;

function matchEndpointHeading(text: string): { method: string; route: string; title: string } | null {
  const m = PATTERN_HEADING_ALT_RE.exec(text) || PATTERN_HEADING_RE.exec(text);
  if (m) {
    return {
      method: m[1].toUpperCase(),
      route: m[2].replace(/`/g, ""),
      title: m[3].trim(),
    };
  }
  return null;
}

export function patternHeadingStrategy(root: AnyNode): DetectionResult | null {
  const children: AnyNode[] = root.children ?? [];
  if (children.length < 3) return null;

  // Find all headings that match the endpoint pattern.
  const matches: Array<{
    node: AnyNode;
    method: string;
    route: string;
    title: string;
  }> = [];

  for (const child of children) {
    if (child.type === "heading") {
      const text = headingText(child.children);
      const match = matchEndpointHeading(text);
      if (match) {
        matches.push({ node: child, ...match });
      }
    }
  }

  // Need at least 3 matched headings to be confident this is a "catalog" file.
  if (matches.length < 3) return null;

  // Determine the heading depth used for the pattern.
  const depth = matches[0].node.depth ?? 3;

  // All matches should share the same depth.
  if (!matches.every((m) => (m.node.depth ?? 0) === depth)) return null;

  const sections: DetectedSection[] = [];
  const referenceSections: DetectedSection[] = [];
  const warnings: string[] = [];

  // Split children by the matching headings.
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const startIdx = children.indexOf(m.node);
    // End is the next matching heading, or the next heading at same/lower depth, or end of file.
    let endIdx = children.length;
    for (let j = i + 1; j < matches.length; j++) {
      const nextMatch = matches[j];
      const nextIdx = children.indexOf(nextMatch.node);
      if (nextIdx > startIdx) {
        endIdx = nextIdx;
        break;
      }
    }
    // Also check for headings at same or lower depth that are NOT endpoint patterns.
    for (let j = startIdx + 1; j < children.length; j++) {
      const child = children[j];
      if (child.type === "heading" && child.depth !== undefined && child.depth <= depth) {
        const t = headingText(child.children);
        if (!matchEndpointHeading(t) && j !== startIdx) {
          const idx = j;
          if (idx < endIdx) {
            endIdx = idx;
          }
          break;
        }
      }
    }

    const sectionChildren = children.slice(startIdx, endIdx);
    const content = mdastChildrenToTiptap(sectionChildren);
    const slugHint = slugify(`${m.method}-${m.route}`);

    sections.push({
      title: `${m.method} ${m.route} — ${m.title}`,
      slugHint,
      method: m.method,
      route: m.route,
      headingDepth: depth,
      startLine: startLine(m.node),
      endLine: i + 1 < matches.length ? startLine(matches[i + 1].node) - 1 : endLine(children[children.length - 1]),
      content,
      orderIndex: i,
    });
  }

  // Find "reference" sections — content before the first endpoint.
  if (sections.length > 0) {
    const firstEndpointIdx = children.indexOf(matches[0].node);
    if (firstEndpointIdx > 0) {
      const refChildren = children.slice(0, firstEndpointIdx);
      if (refChildren.length > 0) {
        const content = mdastChildrenToTiptap(refChildren);
        const refTitle = headingText(children[0]?.children) || "Introduction";
        referenceSections.push({
          title: refTitle,
          slugHint: slugify(refTitle),
          headingDepth: children[0]?.depth ?? 1,
          startLine: 1,
          endLine: startLine(matches[0].node) - 1,
          content,
          orderIndex: 0,
        });
      }
    }
  }

  // Content between endpoint sections that starts with a non-matching heading.
  for (let i = 0; i < matches.length - 1; i++) {
    const mNext = startLine(matches[i + 1].node);
    const midChildren = children.slice(
      children.indexOf(matches[i].node) + 1,
      children.indexOf(matches[i + 1].node),
    );
    for (const mid of midChildren) {
      if (mid.type === "heading" && mid.depth !== undefined && mid.depth < depth) {
        const t = headingText(mid.children);
        referenceSections.push({
          title: t,
          slugHint: slugify(t),
          headingDepth: mid.depth,
          startLine: startLine(mid),
          endLine: mNext - 1,
          content: mdastChildrenToTiptap([mid]),
          orderIndex: sections.length + referenceSections.length,
        });
      }
    }
  }

  // Content after the last endpoint.
  if (sections.length > 0) {
    const lastEndpointIdx = children.indexOf(matches[matches.length - 1].node);
    const trailingChildren = children.slice(lastEndpointIdx + 1);
    if (trailingChildren.length > 0) {
      const firstChild = trailingChildren[0];
      if (firstChild.type === "heading") {
        const t = headingText(firstChild.children);
        referenceSections.push({
          title: t,
          slugHint: slugify(t),
          headingDepth: firstChild.depth ?? depth,
          startLine: startLine(firstChild),
          endLine: endLine(children[children.length - 1]),
          content: mdastChildrenToTiptap(trailingChildren),
          orderIndex: sections.length + referenceSections.length,
        });
      }
    }
  }

  return {
    strategy: "PatternHeadingStrategy",
    sections,
    referenceSections,
    warnings,
  };
}

// ── Strategy 2: NumberedSubsectionStrategy ──────────────────────────────

/**
 * Splits on the heading depth that appears ≥3 times and whose sections are of
 * comparable size — i.e. "whatever repeating heading level looks like a
 * catalog of items."
 */
export function numberedSubsectionStrategy(root: AnyNode): DetectionResult | null {
  const children: AnyNode[] = root.children ?? [];
  if (children.length < 5) return null;

  // Group headings by depth.
  const byDepth = new Map<number, AnyNode[]>();
  for (const child of children) {
    if (child.type === "heading") {
      const d = child.depth ?? 2;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(child);
    }
  }

  // Find the best depth: ≥3 headings, prefer the deepest level.
  let bestDepth = 0;
  let bestCount = 0;
  for (const [d, heads] of byDepth) {
    if (heads.length >= 3 && (heads.length > bestCount || (heads.length === bestCount && d > bestDepth))) {
      bestDepth = d;
      bestCount = heads.length;
    }
  }

  if (bestDepth === 0) return null;

  const headings = byDepth.get(bestDepth)!;

  // Build sections from these headings.
  const sections: DetectedSection[] = [];
  for (let i = 0; i < headings.length; i++) {
    const h = headings[i];
    const startIdx = children.indexOf(h);
    let endIdx = children.length;
    for (let j = i + 1; j < headings.length; j++) {
      const nextIdx = children.indexOf(headings[j]);
      if (nextIdx > startIdx) {
        endIdx = nextIdx;
        break;
      }
    }
    const sectionChildren = children.slice(startIdx, endIdx);
    const text = headingText(h.children);
    sections.push({
      title: text,
      slugHint: slugify(text),
      headingDepth: bestDepth,
      startLine: startLine(h),
      endLine: i + 1 < headings.length ? startLine(headings[i + 1]) - 1 : endLine(children[children.length - 1]),
      content: mdastChildrenToTiptap(sectionChildren),
      orderIndex: i,
    });
  }

  // Everything before the first heading at this depth is a "reference" section.
  const referenceSections: DetectedSection[] = [];
  const firstHeadingIdx = children.indexOf(headings[0]);
  if (firstHeadingIdx > 0) {
    const preChildren = children.slice(0, firstHeadingIdx);
    const content = mdastChildrenToTiptap(preChildren);
    const title = headingText(children[0]?.children) || "Introduction";
    referenceSections.push({
      title,
      slugHint: slugify(title),
      headingDepth: children[0]?.depth ?? 1,
      startLine: 1,
      endLine: startLine(headings[0]) - 1,
      content,
      orderIndex: 0,
    });
  }

  return {
    strategy: "NumberedSubsectionStrategy",
    sections,
    referenceSections,
    warnings: [],
  };
}

// ── Strategy 3: SingleDocumentFallback ──────────────────────────────────

/**
 * If nothing repeats in a catalog-like way, the whole file is imported as
 * one document (no split), and the UI tells the user why.
 */
export function singleDocumentFallback(root: AnyNode, totalLines: number): DetectionResult {
  const content = mdastChildrenToTiptap(root.children ?? []);
  const title = headingText(root.children?.[0]?.children) || "Imported Document";

  return {
    strategy: "SingleDocumentFallback",
    sections: [
      {
        title,
        slugHint: slugify(title),
        headingDepth: root.children?.[0]?.type === "heading" ? (root.children[0].depth ?? 1) : 1,
        startLine: 1,
        endLine: totalLines,
        content,
        orderIndex: 0,
      },
    ],
    referenceSections: [],
    warnings: ["No repeating catalog structure detected — imported as a single document."],
  };
}

// ── Main entry point ────────────────────────────────────────────────────

/**
 * Parse a Markdown string and detect sections using the strategy chain.
 */
export function detectSections(markdown: string): DetectionResult {
  const root = parseMarkdown(markdown);
  const totalLines = markdown.split("\n").length;

  // Strategy chain (ADR-1):
  const result = patternHeadingStrategy(root);
  if (result && result.sections.length >= 3) return result;

  const result2 = numberedSubsectionStrategy(root);
  if (result2 && result2.sections.length >= 3) return result2;

  return singleDocumentFallback(root, totalLines);
}
