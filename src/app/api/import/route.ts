import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { listImportJobs } from "@/services/import.service";

/**
 * GET /api/import
 *
 * List past import jobs (admin/editor visibility).
 */
export async function GET() {
  try {
    const actor = await requireActor();
    const jobs = await listImportJobs(actor);
    return ok(jobs);
  } catch (err) {
    return handleError(err);
  }
}
