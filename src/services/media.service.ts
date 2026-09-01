import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { media } from "@/db/schema";
import { ApiError } from "@/lib/http";
import { requirePermission, PERMISSIONS, type Actor } from "@/lib/auth/permissions";
import { logAudit, AUDIT_ACTIONS } from "./audit.service";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20 MB

const ALLOWED_MIME: Record<string, string> = {
  "image/png": "images",
  "image/jpeg": "images",
  "image/gif": "images",
  "image/webp": "images",
  "image/svg+xml": "images",
  "application/pdf": "documents",
  "text/plain": "documents",
  "application/zip": "attachments",
};

function uploadDir(): string {
  return resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOAD_DIR ?? "./uploads");
}

/** Validates + persists an uploaded file; returns the media record. */
export async function saveUpload(
  actor: Actor,
  file: { name: string; type: string; size: number; arrayBuffer: () => Promise<ArrayBuffer> },
): Promise<{ id: string; filename: string; originalName: string; mimeType: string; size: number; url: string; createdAt: string }> {
  requirePermission(actor, PERMISSIONS.MANAGE_MEDIA);

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError("FILE_TOO_LARGE", "File exceeds the 20 MB limit", 413);
  }
  const category = ALLOWED_MIME[file.type];
  if (!category) {
    throw new ApiError("UNSUPPORTED_FILE_TYPE", `Unsupported file type: ${file.type || "unknown"}`, 415);
  }

  const originalName = sanitizeFilename(file.name);
  const storedName = `${randomUUID()}-${originalName}`;
  const relativePath = `${category}/${storedName}`;

  const dir = join(/* turbopackIgnore: true */ uploadDir(), category);
  await mkdir(dir, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  // Guard against path traversal on the stored name.
  if (relativePath.includes("..") || relativePath.includes("/") === false) {
    throw new ApiError("INVALID_PATH", "Invalid file path", 400);
  }
  await writeFile(join(/* turbopackIgnore: true */ dir, storedName), buffer);

  const [row] = await db
    .insert(media)
    .values({
      filename: storedName,
      originalName,
      mimeType: file.type,
      size: file.size,
      path: relativePath,
      uploadedBy: actor.id,
    })
    .returning();

  await logAudit(actor, {
    action: AUDIT_ACTIONS.MEDIA_UPLOADED,
    entityType: "media",
    entityId: row.id,
    metadata: { originalName, size: file.size },
  });

  return {
    id: row.id,
    filename: row.filename,
    originalName: row.originalName,
    mimeType: row.mimeType,
    size: row.size,
    url: `/api/media/${row.id}/file`,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getMediaById(id: string) {
  const [row] = await db.select().from(media).where(eq(media.id, id)).limit(1);
  if (!row) throw new ApiError("MEDIA_NOT_FOUND", "Media not found", 404);
  return row;
}

export async function listMedia(actor: Actor, limit = 100) {
  requirePermission(actor, PERMISSIONS.READ);
  const rows = await db.select().from(media).orderBy(desc(media.createdAt)).limit(Math.min(limit, 500));
  return rows.map((r) => ({
    id: r.id,
    originalName: r.originalName,
    mimeType: r.mimeType,
    size: r.size,
    url: `/api/media/${r.id}/file`,
    createdAt: r.createdAt.toISOString(),
  }));
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, ".");
  return base || "file";
}
