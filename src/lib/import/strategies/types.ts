import type { Root } from "mdast";
import type { DetectedSection, SplitResult } from "../types";

export interface DetectionStrategy {
  name: string;
  canHandle(ast: Root, rawMarkdown: string): boolean;
  split(ast: Root, rawMarkdown: string, filename: string): SplitResult;
}
