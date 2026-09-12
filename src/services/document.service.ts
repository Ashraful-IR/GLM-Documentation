import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { documentVersions, documents, navigation } from "@/db/schema";
import { ApiError } from "@/lib/http";
import { extractTextFromDoc, limitTextForIndex } from "@/lib/content/text";
import { requirePermission, PERMISSIONS, type Actor } from "@/lib/auth/permissions";
import { logAudit, AUDIT_ACTIONS } from "./audit.service";
import type { TiptapJson } from "@/db/schema";
import type { DocumentDetail, DocumentVersionSummary } from "@/types";

const DOC_NOT_FOUND = "DOCUMENT_NOT_FOUND";
const VERSION_NOT_FOUND = "VERSION_NOT_FOUND";
const DOC_DELETED = "DOCUMENT_DELETED";

const EMPTY_DOC: TiptapJson = { type: "doc", content: [] };

/**
 * PostgreSQL full-text search cannot index a tsvector built from more than
 * 1MB of text (the GIN index expression throws "string is too long for
 * tsvector" and the whole save fails). Search coverage is therefore capped:
 * only the first MAX_INDEXABLE_TEXT_BYTES of extracted text feeds the index.
 * Documents themselves are unlimited — this bounds what is *searchable*, not
 * what can be stored.
 */
const MAX_INDEXABLE_TEXT_BYTES = 500_000; // ~2x headroom under the 1MB tsvector cap

/** Maximum number of version rows kept per document. Older versions beyond
 *  this cap are pruned after each publish/checkpoint to prevent unbounded
 *  table growth. The published snapshot on the documents table always
 *  preserves the latest published content regardless of pruning. */
const MAX_VERSIONS_PER_DOC = 50;

export async function createDocument(
  actor: Actor,
  input: { title: string; content?: TiptapJson; status?: "DRAFT" | "PUBLISHED" },
) {
  requirePermission(actor, PERMISSIONS.CREATE);
  const content = input.content ?? EMPTY_DOC;
  const [doc] = await db
    .insert(documents)
    .values({
      title: input.title,
      content,
      contentText: limitTextForIndex(extractTextFromDoc(content), MAX_INDEXABLE_TEXT_BYTES),
      status: input.status ?? "DRAFT",
      createdBy: actor.id,
      updatedBy: actor.id,
      ...(input.status === "PUBLISHED"
        ? {
            publishedBy: actor.id,
            publishedAt: new Date(),
            currentVersion: 1,
            publishedTitle: input.title,
            publishedContent: content,
          }
        : {}),
    })
    .returning();
  await logAudit(actor, { action: AUDIT_ACTIONS.DOCUMENT_CREATED, entityType: "document", entityId: doc.id });
  if (input.status === "PUBLISHED") {
    await writeVersion(actor, doc.id, { title: doc.title, content, changeSummary: "Initial version" }, 1);
  }
  return toDetail(doc);
}

export async function getDocument(actor: Actor, id: string): Promise<DocumentDetail> {
  requirePermission(actor, PERMISSIONS.READ);
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) throw new ApiError(DOC_NOT_FOUND, "Document not found", 404);
  if (doc.deletedAt) throw new ApiError(DOC_DELETED, "Document is in trash", 404);
  return toDetail(doc);
}

/**
 * Autosave path (§13): updates content directly, NEVER writes a version row.
 */
export async function updateDocumentContent(
  actor: Actor,
  id: string,
  input: { title?: string; content?: TiptapJson },
): Promise<DocumentDetail> {
  requirePermission(actor, PERMISSIONS.UPDATE);
  const [existing] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!existing) throw new ApiError(DOC_NOT_FOUND, "Document not found", 404);
  if (existing.deletedAt) throw new ApiError(DOC_DELETED, "Document is in trash", 409);

  const content = input.content ?? (existing.content as TiptapJson);
  const [updated] = await db
    .update(documents)
    .set({
      ...(input.title !== undefined ? { title: input.title } : {}),
      content,
      contentText: limitTextForIndex(extractTextFromDoc(content), MAX_INDEXABLE_TEXT_BYTES),
      updatedBy: actor.id,
      updatedAt: new Date(),
    })
    .where(eq(documents.id, id))
    .returning();

  await logAudit(actor, { action: AUDIT_ACTIONS.DOCUMENT_UPDATED, entityType: "document", entityId: id });
  return toDetail(updated);
}

/** Publish: writes a version row + flips status (§13). */
export async function publishDocument(
  actor: Actor,
  id: string,
  input: { changeSummary?: string | null },
): Promise<DocumentDetail> {
  requirePermission(actor, PERMISSIONS.PUBLISH);
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).for("update").limit(1);
    if (!doc) throw new ApiError(DOC_NOT_FOUND, "Document not found", 404);
    if (doc.deletedAt) throw new ApiError(DOC_DELETED, "Document is in trash", 409);

    const versionNumber = doc.currentVersion + 1;
    await tx.insert(documentVersions).values({
      documentId: id,
      versionNumber,
      title: doc.title,
      content: doc.content,
      changeSummary: input.changeSummary ?? "Published",
      createdBy: actor.id,
    });
    const [updated] = await tx
      .update(documents)
      .set({
        status: "PUBLISHED",
        currentVersion: versionNumber,
        publishedBy: actor.id,
        publishedAt: new Date(),
        // The working copy becomes the published snapshot — this is the moment
        // draft edits go live for readers.
        publishedTitle: doc.title,
        publishedContent: doc.content,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, id))
      .returning();
    await logAudit(actor, {
      action: AUDIT_ACTIONS.DOCUMENT_PUBLISHED,
      entityType: "document",
      entityId: id,
      metadata: { versionNumber },
    });
    // Prune old versions outside the transaction (best-effort, non-critical).
    await pruneOldVersions(id);
    return toDetail(updated);
  });
}

/** Manual checkpoint: writes a version row WITHOUT changing status (§13). */
export async function checkpointDocument(
  actor: Actor,
  id: string,
  input: { changeSummary?: string | null },
): Promise<DocumentDetail> {
  requirePermission(actor, PERMISSIONS.UPDATE);
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, id)).for("update").limit(1);
    if (!doc) throw new ApiError(DOC_NOT_FOUND, "Document not found", 404);
    if (doc.deletedAt) throw new ApiError(DOC_DELETED, "Document is in trash", 409);

    const versionNumber = doc.currentVersion + 1;
    await tx.insert(documentVersions).values({
      documentId: id,
      versionNumber,
      title: doc.title,
      content: doc.content,
      changeSummary: input.changeSummary ?? null,
      createdBy: actor.id,
    });
    const [updated] = await tx
      .update(documents)
      .set({ currentVersion: versionNumber, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning();
    await logAudit(actor, {
      action: AUDIT_ACTIONS.VERSION_CREATED,
      entityType: "document",
      entityId: id,
      metadata: { versionNumber, kind: "checkpoint" },
    });
    // Prune old versions outside the transaction (best-effort, non-critical).
    await pruneOldVersions(id);
    return toDetail(updated);
  });
}

async function writeVersion(
  actor: Actor,
  documentId: string,
  input: { title: string; content: TiptapJson; changeSummary: string | null },
  versionNumber: number,
): Promise<void> {
  await db.insert(documentVersions).values({
    documentId,
    versionNumber,
    title: input.title,
    content: input.content,
    changeSummary: input.changeSummary,
    createdBy: actor.id,
  });
  await pruneOldVersions(documentId);
}

/** Removes the oldest version rows when count exceeds MAX_VERSIONS_PER_DOC,
 *  keeping the most recent versions. Never removes the latest version. */
async function pruneOldVersions(documentId: string): Promise<void> {
  const allVersions = await db
    .select({ id: documentVersions.id, versionNumber: documentVersions.versionNumber })
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(asc(documentVersions.versionNumber));

  if (allVersions.length <= MAX_VERSIONS_PER_DOC) return;

  const toDelete = allVersions.slice(0, allVersions.length - MAX_VERSIONS_PER_DOC);
  if (toDelete.length === 0) return;

  const ids = toDelete.map((v) => v.id);
  await db
    .delete(documentVersions)
    .where(sql`${documentVersions.id} IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
}

export async function softDeleteDocument(actor: Actor, id: string): Promise<void> {
  requirePermission(actor, PERMISSIONS.DELETE);
  const [updated] = await db
    .update(documents)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning({ id: documents.id });
  if (!updated) throw new ApiError(DOC_NOT_FOUND, "Document not found", 404);
  await db
    .update(navigation)
    .set({ deletedAt: new Date(), updatedAt: new Date(), updatedBy: actor.id })
    .where(eq(navigation.documentId, id));
  await logAudit(actor, { action: AUDIT_ACTIONS.DOCUMENT_DELETED, entityType: "document", entityId: id });
}

export async function restoreDocument(actor: Actor, id: string): Promise<void> {
  requirePermission(actor, PERMISSIONS.UPDATE);
  const [updated] = await db
    .update(documents)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(documents.id, id))
    .returning({ id: documents.id });
  if (!updated) throw new ApiError(DOC_NOT_FOUND, "Document not found", 404);
  await db
    .update(navigation)
    .set({ deletedAt: null, updatedAt: new Date(), updatedBy: actor.id })
    .where(eq(navigation.documentId, id));
  await logAudit(actor, { action: "DOCUMENT_RESTORED", entityType: "document", entityId: id });
}

export async function hardDeleteDocument(actor: Actor, id: string): Promise<void> {
  requirePermission(actor, PERMISSIONS.DELETE);
  await db.delete(navigation).where(eq(navigation.documentId, id));
  await db.delete(documents).where(eq(documents.id, id));
  await logAudit(actor, { action: "DOCUMENT_HARD_DELETED", entityType: "document", entityId: id });
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

export async function listVersions(actor: Actor, documentId: string): Promise<DocumentVersionSummary[]> {
  requirePermission(actor, PERMISSIONS.READ);
  const rows = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.versionNumber));
  return rows.map((r) => ({
    id: r.id,
    documentId: r.documentId,
    versionNumber: r.versionNumber,
    title: r.title,
    changeSummary: r.changeSummary,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function getVersion(actor: Actor, documentId: string, versionNumber: number) {
  requirePermission(actor, PERMISSIONS.READ);
  const [version] = await db
    .select()
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.versionNumber, versionNumber)))
    .limit(1);
  if (!version) throw new ApiError(VERSION_NOT_FOUND, "Version not found", 404);
  return {
    id: version.id,
    documentId: version.documentId,
    versionNumber: version.versionNumber,
    title: version.title,
    changeSummary: version.changeSummary,
    content: version.content,
    createdAt: version.createdAt.toISOString(),
  };
}

/**
 * Restores a version's content into the document. The pre-restore state is
 * snapshotted as a new version so the restore itself is undoable (§13).
 */
export async function restoreVersion(actor: Actor, documentId: string, versionNumber: number): Promise<DocumentDetail> {
  requirePermission(actor, PERMISSIONS.UPDATE);
  return db.transaction(async (tx) => {
    const [doc] = await tx.select().from(documents).where(eq(documents.id, documentId)).for("update").limit(1);
    if (!doc) throw new ApiError(DOC_NOT_FOUND, "Document not found", 404);
    const [version] = await tx
      .select()
      .from(documentVersions)
      .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.versionNumber, versionNumber)))
      .limit(1);
    if (!version) throw new ApiError(VERSION_NOT_FOUND, "Version not found", 404);

    // Snapshot current state so the restore can be undone.
    const nextNumber = doc.currentVersion + 1;
    await tx.insert(documentVersions).values({
      documentId,
      versionNumber: nextNumber,
      title: doc.title,
      content: doc.content,
      changeSummary: `State before restoring v${versionNumber}`,
      createdBy: actor.id,
    });

    const [updated] = await tx
      .update(documents)
      .set({
        title: version.title,
        content: version.content,
        contentText: limitTextForIndex(extractTextFromDoc(version.content), MAX_INDEXABLE_TEXT_BYTES),
        // A restore brings the version back into the working copy; for a
        // published document it also becomes the live snapshot again so the
        // reader page and the "current version" badge stay in sync.
        ...(doc.status === "PUBLISHED"
          ? { publishedTitle: version.title, publishedContent: version.content }
          : {}),
        currentVersion: nextNumber,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, documentId))
      .returning();
    await logAudit(actor, {
      action: AUDIT_ACTIONS.DOCUMENT_RESTORED,
      entityType: "document",
      entityId: documentId,
      metadata: { versionNumber },
    });
    // Prune old versions outside the transaction (best-effort, non-critical).
    await pruneOldVersions(documentId);
    return toDetail(updated);
  });
}

/** Finds the navigation node that points at a document (if any). */
export async function findNavNodeForDocument(documentId: string) {
  const [row] = await db
    .select({ id: navigation.id })
    .from(navigation)
    .where(eq(navigation.documentId, documentId))
    .limit(1);
  return row ?? null;
}

/**
 * True when the working copy contains edits readers can't see yet:
 * - a PUBLISHED document whose content/title drifted from the published snapshot;
 * - a DRAFT document that has actual content (an empty new page is not "changes").
 */
function hasUnpublishedChanges(doc: {
  title: string;
  content: unknown;
  publishedTitle: string | null;
  publishedContent: unknown;
  status: "DRAFT" | "PUBLISHED";
}): boolean {
  if (doc.status === "DRAFT") {
    const content = doc.content as TiptapJson | null;
    return (content?.content?.length ?? 0) > 0;
  }
  if (doc.publishedTitle === null || doc.publishedContent === null) return false;
  return (
    doc.title !== doc.publishedTitle ||
    JSON.stringify(doc.content) !== JSON.stringify(doc.publishedContent)
  );
}

function toDetail(doc: {
  id: string;
  title: string;
  content: unknown;
  contentText: string | null;
  publishedTitle: string | null;
  publishedContent: unknown;
  status: "DRAFT" | "PUBLISHED";
  currentVersion: number;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string | null;
  updatedBy: string | null;
}): DocumentDetail {
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    contentText: doc.contentText ?? "",
    publishedTitle: doc.publishedTitle,
    publishedContent: doc.publishedContent ?? null,
    status: doc.status,
    currentVersion: doc.currentVersion,
    publishedAt: doc.publishedAt ? doc.publishedAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
    createdBy: doc.createdBy,
    updatedBy: doc.updatedBy,
    hasUnpublishedChanges: hasUnpublishedChanges(doc),
  };
}
