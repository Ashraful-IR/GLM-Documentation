import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { NextResponse } from "next/server";

import { requireActor } from "@/lib/auth/actor";
import { getMediaById } from "@/services/media.service";
import { handleError } from "@/lib/http";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function GET(_req: Request, ctx: Ctx) {
  try {
    await requireActor();
    const { id } = await ctx.params;
    const record = await getMediaById(id);

    const uploadDir = resolve(/* turbopackIgnore: true */ process.cwd(), process.env.UPLOAD_DIR ?? "./uploads");
    const filePath = join(/* turbopackIgnore: true */ uploadDir, record.path);
    // Path traversal guard: the stored path is always category/filename.
    if (!filePath.startsWith(uploadDir)) {
      return NextResponse.json({ success: false, error: { code: "INVALID_PATH", message: "Invalid path" } }, { status: 400 });
    }
    const info = await stat(/* turbopackIgnore: true */ filePath).catch(() => null);
    if (!info) {
      return NextResponse.json({ success: false, error: { code: "FILE_MISSING", message: "File missing on disk" } }, { status: 404 });
    }

    const stream = createReadStream(/* turbopackIgnore: true */ filePath);
    return new NextResponse(stream as unknown as BodyInit, {
      headers: {
        "Content-Type": record.mimeType,
        "Content-Length": String(info.size),
        "Content-Disposition": `inline; filename="${record.originalName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    return handleError(err);
  }
}
