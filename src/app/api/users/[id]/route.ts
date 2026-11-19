import { NextRequest } from "next/server";

import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { updateUserSchema } from "@/schemas/user.schema";
import * as userService from "@/services/user.service";

export async function PATCH(req: NextRequest, ctx: RouteContext<"/api/users/[id]">) {
  try {
    const actor = await requireActor();
    const { id } = await ctx.params;
    const input = updateUserSchema.parse(await req.json());
    if (input.status) {
      return ok(await userService.setUserStatus(actor, id, input.status));
    }
    if (input.role) {
      return ok(await userService.updateUserRole(actor, id, input.role));
    }
    if (input.teamId || input.designationId) {
      return ok(await userService.updateUserProfileByAdmin(actor, id, input));
    }
    // Name-only edits keep their original meaning: the caller's own profile.
    return ok(await userService.updateProfile(actor.id, { name: input.name }));
  } catch (err) {
    return handleError(err);
  }
}
