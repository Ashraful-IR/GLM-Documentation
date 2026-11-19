import { NextRequest } from "next/server";

import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { lookupNameSchema } from "@/schemas/user.schema";
import { deleteLookup, renameLookup } from "@/services/lookup.service";

interface Ctx {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const actor = await requireActor();
    const { id } = await ctx.params;
    const { name } = lookupNameSchema.parse(await req.json());
    return ok(await renameLookup(actor, "designation", id, name));
  } catch (err) {
    return handleError(err);
  }
}

export async function DELETE(_req: NextRequest, ctx: Ctx) {
  try {
    const actor = await requireActor();
    const { id } = await ctx.params;
    return ok(await deleteLookup(actor, "designation", id));
  } catch (err) {
    return handleError(err);
  }
}
