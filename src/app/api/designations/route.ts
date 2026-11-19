import { NextRequest } from "next/server";

import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { PERMISSIONS, requirePermission } from "@/lib/auth/permissions";
import { lookupNameSchema } from "@/schemas/user.schema";
import { createLookup, listLookup } from "@/services/lookup.service";

/** Admin list, including how many users are assigned to each. */
export async function GET() {
  try {
    const actor = await requireActor();
    requirePermission(actor, PERMISSIONS.MANAGE_USERS);
    return ok(await listLookup("designation"));
  } catch (err) {
    return handleError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor();
    const { name } = lookupNameSchema.parse(await req.json());
    return ok(await createLookup(actor, "designation", name), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
