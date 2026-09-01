import { z } from "zod";
import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { commitImport } from "@/services/import.service";

const commitSchema = z.object({
  jobId: z.string().uuid(),
  items: z.array(
    z.object({
      matchKey: z.string(),
      title: z.string(),
      slugHint: z.string(),
      orderIndex: z.number(),
      excluded: z.boolean(),
      existingItemId: z.string().uuid().nullable(),
      conflict: z.boolean(),
    }),
  ),
  referenceItems: z
    .array(
      z.object({
        matchKey: z.string(),
        title: z.string(),
        slugHint: z.string(),
        orderIndex: z.number(),
        excluded: z.boolean(),
        existingItemId: z.string().uuid().nullable(),
        conflict: z.boolean(),
      }),
    )
    .optional(),
  parentNavigationId: z.string().uuid().nullable().optional(),
});

/**
 * POST /api/import/commit
 *
 * Persist an (optionally user-edited) preview: creates Folder + Document +
 * Navigation rows in DRAFT status.  The user may rename, exclude, merge, or
 * re-parent entries before committing.
 */
export async function POST(req: Request) {
  try {
    const actor = await requireActor();
    const input = commitSchema.parse(await req.json());
    const result = await commitImport(actor, input);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
