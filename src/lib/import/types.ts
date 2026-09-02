import type { Root, RootContent } from "mdast";
import type { TiptapDocument } from "@/types/editor";

export type SectionType = "CATALOG" | "REFERENCE" | "DOCUMENT";

export interface DetectedSection {
  id: string;
  title: string;
  slug: string;
  type: SectionType;
  method?: string | null;
  route?: string | null;
  headingDepth: number;
  orderIndex: number;
  rawMarkdown: string;
  mdastNodes: RootContent[];
  contentSummary?: {
    wordCount: number;
    tableCount: number;
    codeBlockCount: number;
  };
}

export interface SplitResult {
  strategy: string;
  suggestedFolderTitle: string;
  suggestedFolderSlug: string;
  sections: DetectedSection[];
  referenceSections: DetectedSection[];
  warnings: string[];
}

export interface ImportPreviewResponse {
  strategy: string;
  suggestedFolderTitle: string;
  suggestedFolderSlug: string;
  sections: Array<{
    id: string;
    title: string;
    slug: string;
    type: SectionType;
    method?: string | null;
    route?: string | null;
    orderIndex: number;
    rawMarkdown: string;
    contentSummary?: {
      wordCount: number;
      tableCount: number;
      codeBlockCount: number;
    };
  }>;
  referenceSections: Array<{
    id: string;
    title: string;
    slug: string;
    type: SectionType;
    method?: string | null;
    route?: string | null;
    orderIndex: number;
    rawMarkdown: string;
    contentSummary?: {
      wordCount: number;
      tableCount: number;
      codeBlockCount: number;
    };
  }>;
  warnings: string[];
}

export interface ImportCommitItem {
  id?: string;
  title: string;
  slug: string;
  type: SectionType;
  rawMarkdown: string;
  orderIndex: number;
  include: boolean;
}

export interface ImportCommitPayload {
  sourceFilename: string;
  rawMarkdown: string;
  strategyUsed: string;
  parentId?: string | null;
  createFolder: boolean;
  folderTitle: string;
  folderSlug: string;
  autoPublish?: boolean;
  items: ImportCommitItem[];
}

export interface ImportCommitResult {
  jobId: string;
  folderId: string | null;
  createdCount: number;
  autoPublished: boolean;
  firstDocumentSlugPath: string | null;
}
