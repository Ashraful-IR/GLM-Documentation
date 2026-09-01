import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { getImportJobStatus } from "@/services/import.service";

/**
 * GET /api/import/:jobId
 *
 * Fetch the status/result of an import job, for polling large imports.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  try {
    const actor = await requireActor();
    const { jobId } = await params;
    const status = await getImportJobStatus(actor, jobId);
    return ok(status);
  } catch (err) {
    return handleError(err);
  }
}
