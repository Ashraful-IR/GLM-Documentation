import { NextRequest } from "next/server";

import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { importAnalyzeSchema } from "@/schemas/import.schema";
import { ImportService } from "@/services/import.service";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor();

    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      const parentId = (formData.get("parentId") as string) || null;

      if (!file) {
        return handleError(new Error("No file uploaded"));
      }

      const rawMarkdown = await file.text();
      const filename = file.name || "Imported-Document.md";

      const preview = ImportService.analyze(actor, {
        rawMarkdown,
        filename,
        parentId,
      });

      return ok(preview);
    }

    // JSON payload
    const body = await req.json();
    const input = importAnalyzeSchema.parse(body);
    const preview = ImportService.analyze(actor, input);

    return ok(preview);
  } catch (err) {
    return handleError(err);
  }
}
