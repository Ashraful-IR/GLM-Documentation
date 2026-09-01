import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { analyzeImport } from "@/services/import.service";

/**
 * POST /api/import/analyze
 *
 * Upload a .md file, run parse + detection, return a preview of the proposed
 * split.  NO database writes to navigation/documents — only an import_job
 * record in PARSED status for audit.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireActor();

    const contentType = req.headers.get("content-type") ?? "";

    let filename: string;
    let markdown: string;

    if (contentType.includes("multipart/form-data")) {
      // File upload path.
      const form = await req.formData();
      const file = form.get("file");
      if (!file || !(file instanceof File)) {
        return handleError({ code: "MISSING_FILE", message: "A .md file is required", status: 422 });
      }
      filename = file.name || "import.md";
      markdown = await file.text();
    } else {
      // JSON body path (for programmatic use).
      const body = await req.json();
      filename = body.filename || "import.md";
      markdown = body.markdown;
      if (typeof markdown !== "string") {
        return handleError({ code: "INVALID_INPUT", message: "markdown string is required", status: 422 });
      }
    }

    if (!markdown.trim()) {
      return handleError({ code: "EMPTY_FILE", message: "The uploaded file is empty", status: 422 });
    }

    // Optional: limit file size to 5 MB (NFR-1).
    if (markdown.length > 5 * 1024 * 1024) {
      return handleError({ code: "FILE_TOO_LARGE", message: "File exceeds 5 MB limit", status: 422 });
    }

    const parentId = null; // Could be sent as form field if needed.

    const preview = await analyzeImport(actor, {
      markdown,
      filename,
      parentId,
    });

    return ok(preview);
  } catch (err) {
    return handleError(err);
  }
}
