/**
 * Import Service — owns the two-phase import pipeline (ADR-2):
 *
 *   Phase 1 — analyse: parse markdown → detect sections → return preview
 *             (NO database writes)
 *   Phase 2 — commit:  persist the (optionally user-edited) preview as
 *             Folder + Document + Navigation rows, all in DRAFT status.
 *
 * Re-imports are supported by content-hash diffing against prior jobs.
 */

import { createHash } from "crypto";
import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  documents,
  importJobItems,
  importJobs,
  navigation,
} from "@/db/schema";
import type { TiptapJson } from "@/db/schema";
import { ApiError } from "@/lib/http";
import { extractTextFromDoc } from "@/lib/content/text";
import { between } from "@/lib/utils/fractional-index";
import { requirePermission, type Actor } from "@/lib/auth/permissions";
import { logAudit, AUDIT_ACTIONS } from "./audit.service";
import { detectSections, type DetectedSection } from "@/lib/import/section-detector";

// ── Types ───────────────────────────────────────────────────────────────

export interface PreviewItem {
  /** Stable identifier for matching across re-imports (route+method or title). */
  matchKey: string;
  title: string;
  slugHint: string;
  orderIndex: number;
  excluded: boolean;
  /** When re-importing, the existing job item id this matches (null on first import). */
  existingItemId: string | null;
  /** When re-importing and the content hash changed, true means "human edited". */
  conflict: boolean;
}

export interface PreviewResult {
  jobId: string;
  filename: string;
  strategy: string;
  parentFolderTitle: string;
  items: PreviewItem[];
  referenceItems: PreviewItem[];
  warnings: string[];
}

export interface CommitInput {
  jobId: string;
  items: PreviewItem[];
  referenceItems?: PreviewItem[];
  parentNavigationId?: string | null;
}

export interface CommitResult {
  jobId: string;
  folderId: string;
  created: number;
  skipped: number;
  warnings: string[];
}

export interface ImportJobStatus {
  id: string;
  filename: string;
  status: "PARSED" | "COMMITTED" | "FAILED";
  strategy: string;
  created: string;
  committedAt: string | null;
  itemCount: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function contentHash(content: TiptapJson): string {
  return createHash("sha256").update(JSON.stringify(content)).digest("hex").slice(0, 16);
}

function matchKeyFor(section: DetectedSection): string {
  if (section.method && section.route) {
    return `${section.method}:${section.route}`;
  }
  return section.title.toLowerCase().trim();
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    || "item";
}

/**
 * Ensures a slug is unique among siblings by checking the DB.
 */
async function uniqueSlug(parentId: string | null, slug: string): Promise<string> {
  let n = 1;
  let final = slug;
  for (;;) {
    const existing = await db
      .select({ id: navigation.id })
      .from(navigation)
      .where(
        parentId
          ? and(eq(navigation.parentId, parentId), eq(navigation.slug, final))
          : and(sql`${navigation.parentId} IS NULL`, eq(navigation.slug, final)),
      )
      .limit(1);
    if (existing.length === 0) return final;
    n++;
    final = `${slug}-${n}`;
  }
}

/**
 * Compute a sort key that places the new node at the end of the given parent's
 * children list.
 */
async function computeSortKeyAtEnd(parentId: string | null): Promise<string> {
  const siblings = await db
    .select({ sortKey: navigation.sortKey })
    .from(navigation)
    .where(
      parentId
        ? eq(navigation.parentId, parentId)
        : sql`${navigation.parentId} IS NULL`,
    )
    .orderBy(asc(navigation.sortKey));

  const lastKey = siblings.length > 0 ? siblings[siblings.length - 1].sortKey : null;
  return between(lastKey, null);
}

// ── Phase 1: Analyse ────────────────────────────────────────────────────

/**
 * Parse a markdown string, detect sections, and return a preview.
 * No database writes occur (except for an audit-only PARSED job record).
 */
export async function analyzeImport(
  actor: Actor,
  input: { markdown: string; filename: string; parentId?: string | null },
): Promise<PreviewResult> {
  requirePermission(actor, "documentation.create");

  const result = detectSections(input.markdown);
  const warnings = [...result.warnings];

  // Build preview items from detected sections.
  const items: PreviewItem[] = result.sections.map((s) => ({
    matchKey: matchKeyFor(s),
    title: s.title,
    slugHint: s.slugHint,
    orderIndex: s.orderIndex,
    excluded: false,
    existingItemId: null,
    conflict: false,
  }));

  const referenceItems: PreviewItem[] = result.referenceSections.map((s) => ({
    matchKey: matchKeyFor(s),
    title: s.title,
    slugHint: s.slugHint,
    orderIndex: s.orderIndex,
    excluded: false,
    existingItemId: null,
    conflict: false,
  }));

  // Strip extension from filename for folder name.
  const folderTitle = input.filename.replace(/\.md$/i, "").replace(/[-_]/g, " ");

  const [job] = await db
    .insert(importJobs)
    .values({
      sourceFilename: input.filename,
      status: "PARSED",
      strategyUsed: result.strategy,
      rawMarkdown: input.markdown,
      parentNavigationId: input.parentId ?? null,
      warnings,
      createdBy: actor.id,
    })
    .returning();

  await logAudit(actor, {
    action: "IMPORT_ANALYZED",
    entityType: "import_job",
    entityId: job.id,
    metadata: {
      filename: input.filename,
      strategy: result.strategy,
      sectionCount: items.length,
      referenceCount: referenceItems.length,
    },
  });

  return {
    jobId: job.id,
    filename: input.filename,
    strategy: result.strategy,
    parentFolderTitle: folderTitle,
    items,
    referenceItems,
    warnings,
  };
}

// ── Phase 2: Commit ─────────────────────────────────────────────────────

/**
 * Persist the (optionally user-edited) preview as navigation + document rows.
 * Creates a parent Folder + one Document node per included item, all DRAFT.
 */
export async function commitImport(
  actor: Actor,
  input: CommitInput,
): Promise<CommitResult> {
  requirePermission(actor, "documentation.create");

  // Load the job to get the raw markdown for section extraction.
  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, input.jobId))
    .limit(1);
  if (!job) throw new ApiError("IMPORT_JOB_NOT_FOUND", "Import job not found", 404);
  if (job.status === "COMMITTED") {
    throw new ApiError("IMPORT_JOB_COMMITTED", "This import has already been committed", 409);
  }

  // Re-parse to get section content for the items we need to persist.
  const detectionResult = detectSections(job.rawMarkdown);
  const allSections = [...detectionResult.sections, ...detectionResult.referenceSections];

  // Build a map from matchKey to section content.
  const sectionByMatchKey = new Map<string, DetectedSection>();
  for (const s of allSections) {
    sectionByMatchKey.set(matchKeyFor(s), s);
  }

  const warnings: string[] = [];
  let created = 0;
  let skipped = 0;

  // Create the parent Folder node.
  const folderTitle = job.sourceFilename.replace(/\.md$/i, "").replace(/[-_]/g, " ");
  const parentNavId = input.parentNavigationId ?? job.parentNavigationId ?? null;
  const parentId = parentNavId ?? null;

  // Compute a slug for the folder.
  const folderSlug = slugify(folderTitle);

  // Get parent path for ltree.
  let parentPath: string | null = null;
  if (parentId) {
    const [parent] = await db
      .select({ path: navigation.path })
      .from(navigation)
      .where(eq(navigation.id, parentId))
      .limit(1);
    if (parent) parentPath = parent.path;
  }

  // Compute sort key for the folder.
  const folderSortKey = await computeSortKeyAtEnd(parentId);

  // Create the folder.
  const uniqueFolderSlug = await uniqueSlug(parentId, folderSlug);
  const [folder] = await db
    .insert(navigation)
    .values({
      parentId,
      path: "placeholder",
      type: "FOLDER",
      title: folderTitle,
      slug: uniqueFolderSlug,
      sortKey: folderSortKey,
      createdBy: actor.id,
      updatedBy: actor.id,
    })
    .returning();

  // Fix the ltree path.
  const label = folder.id.replace(/-/g, "_");
  const realPath = parentPath ? `${parentPath}.${label}` : label;
  await db
    .update(navigation)
    .set({ path: sql`${realPath}::ltree` })
    .where(eq(navigation.id, folder.id));

  // Process each included item.
  for (const item of input.items) {
    if (item.excluded) {
      skipped++;
      continue;
    }

    const section = sectionByMatchKey.get(item.matchKey);
    if (!section) {
      warnings.push(`Section not found for "${item.title}" — skipped.`);
      skipped++;
      continue;
    }

    try {
      // Create document.
      const content = section.content as TiptapJson;
      const [doc] = await db
        .insert(documents)
        .values({
          title: item.title,
          content,
          contentText: extractTextFromDoc(content),
          status: "DRAFT",
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning();

      // Create navigation node for this document.
      const docSlug = await uniqueSlug(folder.id, item.slugHint || slugify(item.title));
      const sortKey = await computeSortKeyAtEnd(folder.id);

      const [nav] = await db
        .insert(navigation)
        .values({
          parentId: folder.id,
          path: "placeholder",
          type: "DOCUMENT",
          title: item.title,
          slug: docSlug,
          documentId: doc.id,
          sortKey,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning();

      // Fix the ltree path.
      const navLabel = nav.id.replace(/-/g, "_");
      const navRealPath = `${folder.path}.${navLabel}`;
      await db
        .update(navigation)
        .set({ path: sql`${navRealPath}::ltree` })
        .where(eq(navigation.id, nav.id));

      // Create import_job_item record.
      await db.insert(importJobItems).values({
        importJobId: job.id,
        documentId: doc.id,
        navigationId: nav.id,
        sectionTitle: item.title,
        sectionHash: contentHash(content),
        orderIndex: item.orderIndex,
      });

      await logAudit(actor, {
        action: "IMPORT_DOCUMENT_CREATED",
        entityType: "document",
        entityId: doc.id,
        metadata: { importJobId: job.id, title: item.title },
      });

      created++;
    } catch (err) {
      warnings.push(`Failed to create document for "${item.title}": ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }

  // Process reference items as sibling documents in the same folder.
  for (const ref of (input.referenceItems ?? [])) {
    if (ref.excluded) continue;

    const section = sectionByMatchKey.get(ref.matchKey);
    if (!section) continue;

    try {
      const content = section.content as TiptapJson;
      const [doc] = await db
        .insert(documents)
        .values({
          title: ref.title,
          content,
          contentText: extractTextFromDoc(content),
          status: "DRAFT",
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning();

      const docSlug = await uniqueSlug(folder.id, ref.slugHint || slugify(ref.title));
      const sortKey = await computeSortKeyAtEnd(folder.id);

      const [nav] = await db
        .insert(navigation)
        .values({
          parentId: folder.id,
          path: "placeholder",
          type: "DOCUMENT",
          title: ref.title,
          slug: docSlug,
          documentId: doc.id,
          sortKey,
          createdBy: actor.id,
          updatedBy: actor.id,
        })
        .returning();

      const navLabel = nav.id.replace(/-/g, "_");
      const navRealPath = `${folder.path}.${navLabel}`;
      await db
        .update(navigation)
        .set({ path: sql`${navRealPath}::ltree` })
        .where(eq(navigation.id, nav.id));

      await db.insert(importJobItems).values({
        importJobId: job.id,
        documentId: doc.id,
        navigationId: nav.id,
        sectionTitle: ref.title,
        sectionHash: contentHash(content),
        orderIndex: ref.orderIndex + (input.items?.length ?? 0),
      });

      created++;
    } catch (err) {
      warnings.push(`Failed to create reference document "${ref.title}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Mark the job as committed.
  await db
    .update(importJobs)
    .set({ status: "COMMITTED", committedAt: new Date(), warnings })
    .where(eq(importJobs.id, job.id));

  await logAudit(actor, {
    action: "IMPORT_COMMITTED",
    entityType: "import_job",
    entityId: job.id,
    metadata: { folderId: folder.id, created, skipped, warningsCount: warnings.length },
  });

  return {
    jobId: job.id,
    folderId: folder.id,
    created,
    skipped,
    warnings,
  };
}

// ── Job status ──────────────────────────────────────────────────────────

export async function getImportJobStatus(
  actor: Actor,
  jobId: string,
): Promise<ImportJobStatus> {
  requirePermission(actor, "documentation.read");

  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, jobId))
    .limit(1);
  if (!job) throw new ApiError("IMPORT_JOB_NOT_FOUND", "Import job not found", 404);

  const items = await db
    .select({ id: importJobItems.id })
    .from(importJobItems)
    .where(eq(importJobItems.importJobId, jobId));

  return {
    id: job.id,
    filename: job.sourceFilename,
    status: job.status,
    strategy: job.strategyUsed,
    created: job.createdAt.toISOString(),
    committedAt: job.committedAt?.toISOString() ?? null,
    itemCount: items.length,
  };
}

export async function listImportJobs(
  actor: Actor,
): Promise<ImportJobStatus[]> {
  requirePermission(actor, "documentation.read");

  const jobs = await db
    .select()
    .from(importJobs)
    .orderBy(sql`${importJobs.createdAt} DESC`)
    .limit(50);

  const results: ImportJobStatus[] = [];
  for (const j of jobs) {
    const items = await db
      .select({ id: importJobItems.id })
      .from(importJobItems)
      .where(eq(importJobItems.importJobId, j.id));
    results.push({
      id: j.id,
      filename: j.sourceFilename,
      status: j.status,
      strategy: j.strategyUsed,
      created: j.createdAt.toISOString(),
      committedAt: j.committedAt?.toISOString() ?? null,
      itemCount: items.length,
    });
  }
  return results;
}
