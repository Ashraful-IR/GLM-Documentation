import { NextRequest } from "next/server";

import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { importCommitSchema } from "@/schemas/import.schema";
import { ImportService } from "@/services/import.service";

export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor();
    const body = await req.json();
    const input = importCommitSchema.parse(body);

    const result = await ImportService.commit(actor, input);
    return ok(result);
  } catch (err) {
    return handleError(err);
  }
}
