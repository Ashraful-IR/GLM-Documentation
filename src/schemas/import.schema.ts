import { z } from "zod";

export const importAnalyzeSchema = z.object({
  rawMarkdown: z.string().min(1, "Markdown content cannot be empty"),
  filename: z.string().default("Imported-Document.md"),
  parentId: z.string().uuid().nullable().optional(),
});

export const importCommitItemSchema = z.object({
  id: z.string().optional(),
  title: z.string().min(1, "Title cannot be empty"),
  slug: z.string().min(1, "Slug cannot be empty"),
  type: z.enum(["CATALOG", "REFERENCE", "DOCUMENT"]),
  rawMarkdown: z.string(),
  orderIndex: z.number().int().default(0),
  include: z.boolean().default(true),
});

export const importCommitSchema = z.object({
  sourceFilename: z.string().min(1),
  rawMarkdown: z.string().default(""),
  strategyUsed: z.string().default("PatternHeadingStrategy"),
  parentId: z.string().uuid().nullable().optional(),
  createFolder: z.boolean().default(true),
  folderTitle: z.string().min(1, "Folder title cannot be empty"),
  folderSlug: z.string().min(1, "Folder slug cannot be empty"),
  autoPublish: z.boolean().default(true),
  items: z.array(importCommitItemSchema).min(1, "At least one section must be provided"),
});

export type ImportAnalyzeInput = z.infer<typeof importAnalyzeSchema>;
export type ImportCommitInput = z.infer<typeof importCommitSchema>;
