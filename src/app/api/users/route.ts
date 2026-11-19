import { NextRequest } from "next/server";

import { ok, handleError } from "@/lib/http";
import { requireActor } from "@/lib/auth/actor";
import { adminCreateUserSchema, listUsersQuerySchema } from "@/schemas/user.schema";
import * as userService from "@/services/user.service";

export async function GET(req: NextRequest) {
  try {
    const actor = await requireActor();
    const { status } = listUsersQuerySchema.parse({
      status: req.nextUrl.searchParams.get("status") ?? undefined,
    });
    return ok(await userService.listUsers(actor, { status }));
  } catch (err) {
    return handleError(err);
  }
}

/** Admin creates a user directly — active immediately, no approval step. */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireActor();
    const input = adminCreateUserSchema.parse(await req.json());
    return ok(await userService.createUserByAdmin(actor, input), { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
