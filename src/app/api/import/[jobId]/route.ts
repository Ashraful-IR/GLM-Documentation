import { NextRequest } from "next/server";

import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { ImportService } from "@/services/import.service";

interface Ctx {
  params: Promise<{ jobId: string }>;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  try {
    const actor = await requireActor();
    const { jobId } = await ctx.params;
    const result = await ImportService.getJob(actor, jobId);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
