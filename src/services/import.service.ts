import { createHash } from "node:crypto";
import { eq, desc } from "drizzle-orm";

import { db } from "@/db";
import {
  importJobs,
  importJobItems,
  documents,
  navigation,
  type ImportJobRow,
  type ImportJobItemRow,
} from "@/db/schema";
import { ApiError } from "@/lib/http";
import { requirePermission, PERMISSIONS, type Actor } from "@/lib/auth/permissions";
import { logAudit, AUDIT_ACTIONS } from "./audit.service";
import { createDocument } from "./document.service";
import { createNode } from "./navigation.service";
import { analyzeMarkdown, parseMarkdownToAst, mdastToTiptap } from "@/lib/import";
import type {
  ImportCommitPayload,
  ImportCommitResult,
  ImportPreviewResponse,
} from "@/lib/import/types";

export function computeContentHash(content: string): string {
  return createHash("sha256").update(content.trim()).digest("hex");
}

export class ImportService {
  /**
   * Analyzes a raw markdown document and returns a structured preview.
   * Pure parsing phase without persisting to the database.
   */
  static analyze(
    actor: Actor,
    input: { rawMarkdown: string; filename: string; parentId?: string | null }
  ): ImportPreviewResponse {
    requirePermission(actor, PERMISSIONS.CREATE);

    if (!input.rawMarkdown || !input.rawMarkdown.trim()) {
      throw new ApiError("EMPTY_MARKDOWN", "Markdown content cannot be empty", 400);
    }

    const { preview } = analyzeMarkdown(input.rawMarkdown, input.filename || "Imported-Document.md");
    return preview;
  }

  /**
   * Persists an analyzed import batch:
   * 1. Creates target folder if requested.
   * 2. Converts each section's markdown to Tiptap JSON.
   * 3. Creates Document rows with auto-publish support.
   * 4. Creates Navigation nodes in sort order.
   * 5. Records import_jobs and import_job_items for audit and conflict tracking.
   */
  static async commit(
    actor: Actor,
    payload: ImportCommitPayload
  ): Promise<ImportCommitResult> {
    requirePermission(actor, PERMISSIONS.CREATE);

    if (!payload.items || payload.items.length === 0) {
      throw new ApiError("EMPTY_IMPORT_ITEMS", "No items provided to import", 400);
    }

    const autoPublish = payload.autoPublish !== false;
    const includedItems = payload.items.filter((item) => item.include !== false);

    if (includedItems.length === 0) {
      throw new ApiError("NO_INCLUDED_ITEMS", "At least one item must be included", 400);
    }

    // 1. Create the initial import job record
    const [job] = await db
      .insert(importJobs)
      .values({
        sourceFilename: payload.sourceFilename,
        status: "ANALYZED",
        strategyUsed: payload.strategyUsed || "PatternHeadingStrategy",
        rawMarkdown: payload.rawMarkdown || "",
        parentNavigationId: payload.parentId ?? null,
        totalSections: payload.items.length,
        importedSections: 0,
        autoPublished: autoPublish,
        createdBy: actor.id,
      })
      .returning();

    let targetParentId: string | null = payload.parentId ?? null;
    let folderNodeId: string | null = null;
    let firstDocumentSlugPath: string | null = null;

    try {
      // 2. Create the parent folder if requested
      if (payload.createFolder) {
        const folderNode = await createNode(actor, {
          parentId: payload.parentId ?? null,
          type: "FOLDER",
          title: payload.folderTitle || "Imported Documentation",
          slug: payload.folderSlug || "imported-documentation",
        });
        targetParentId = folderNode.id;
        folderNodeId = folderNode.id;
      }

      let createdCount = 0;

      // 3. Process each included item sequentially to maintain fractional order
      for (let i = 0; i < includedItems.length; i++) {
        const item = includedItems[i];

        // Parse markdown content to AST and map to valid Tiptap JSON
        const ast = parseMarkdownToAst(item.rawMarkdown || `# ${item.title}`);
        const tiptapContent = mdastToTiptap(ast);

        // Create the document (Auto-published or Draft)
        const doc = await createDocument(actor, {
          title: item.title,
          content: tiptapContent,
          status: autoPublish ? "PUBLISHED" : "DRAFT",
        });

        // Create the navigation node linking to this document
        const navNode = await createNode(actor, {
          parentId: targetParentId,
          type: "DOCUMENT",
          title: item.title,
          slug: item.slug,
          documentId: doc.id,
        });

        if (i === 0) {
          firstDocumentSlugPath = payload.createFolder
            ? `${payload.folderSlug}/${item.slug}`
            : item.slug;
        }

        // Record import job item
        const sectionHash = computeContentHash(item.rawMarkdown || item.title);
        await db.insert(importJobItems).values({
          importJobId: job.id,
          documentId: doc.id,
          navigationId: navNode.id,
          sectionTitle: item.title,
          sectionSlug: item.slug,
          sectionHash,
          orderIndex: item.orderIndex ?? i,
          status: "SUCCESS",
        });

        createdCount++;
      }

      // 4. Update import job as COMMITTED
      await db
        .update(importJobs)
        .set({
          status: "COMMITTED",
          targetFolderId: folderNodeId,
          importedSections: createdCount,
          committedAt: new Date(),
        })
        .where(eq(importJobs.id, job.id));

      // 5. Log audit
      await logAudit(actor, {
        action: "IMPORT_MARKDOWN",
        entityType: "import_job",
        entityId: job.id,
        metadata: {
          sourceFilename: payload.sourceFilename,
          folderTitle: payload.folderTitle,
          createdCount,
          autoPublished: autoPublish,
        },
      });

      return {
        jobId: job.id,
        folderId: folderNodeId,
        createdCount,
        autoPublished: autoPublish,
        firstDocumentSlugPath,
      };
    } catch (err) {
      // Mark job as failed if error occurs
      await db
        .update(importJobs)
        .set({ status: "FAILED" })
        .where(eq(importJobs.id, job.id));
      throw err;
    }
  }

  /**
   * Retrieves an import job with its items.
   */
  static async getJob(
    actor: Actor,
    jobId: string
  ): Promise<{ job: ImportJobRow; items: ImportJobItemRow[] }> {
    requirePermission(actor, PERMISSIONS.READ);

    const [job] = await db
      .select()
      .from(importJobs)
      .where(eq(importJobs.id, jobId))
      .limit(1);

    if (!job) {
      throw new ApiError("IMPORT_JOB_NOT_FOUND", "Import job not found", 404);
    }

    const items = await db
      .select()
      .from(importJobItems)
      .where(eq(importJobItems.importJobId, jobId));

    return { job, items };
  }
}
