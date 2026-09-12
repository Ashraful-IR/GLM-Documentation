import { z } from "zod";
import type { TiptapJson } from "@/db/schema";

/**
 * Lightweight structural check — the editor owns deep JSON validation.
 * Typed as TiptapJson so parsed values flow straight into services.
 */
const tiptapJson: z.ZodType<TiptapJson> = z.custom<TiptapJson>((v) => {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as { type?: unknown }).type === "doc"
  );
});

/**
 * Upper bound on a document payload (working copy, not raw text). Tiptap JSON
 * is 3–10x larger than its plain text, so this bounds roughly 4MB of text —
 * far above anything a real Word import produces, but it fails fast with a
 * clear 413 instead of a cryptic 500 deep in the DB layer.
 */
export const MAX_DOCUMENT_PAYLOAD_BYTES = 16 * 1024 * 1024; // 16MB

const tiptapJsonWithCap = tiptapJson.refine(
  (v) => !v.content || Buffer.byteLength(JSON.stringify(v), "utf8") <= MAX_DOCUMENT_PAYLOAD_BYTES,
  { message: "Document is too large (over 16MB of JSON). Split it into multiple pages." },
);

export const createDocumentSchema = z.object({
  title: z.string().min(1).max(300),
  content: tiptapJsonWithCap.optional(),
  status: z.enum(["DRAFT", "PUBLISHED"]).optional(),
});

export const updateDocumentSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  content: tiptapJsonWithCap.optional(),
  // Server always recomputes contentText from content; nothing to pass here.
});

export const publishDocumentSchema = z.object({
  changeSummary: z.string().max(500).nullable().optional(),
});

export const checkpointSchema = z.object({
  changeSummary: z.string().max(500).nullable().optional(),
});

export const restoreVersionSchema = z.object({
  versionNumber: z.number().int().positive(),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
