import { NextRequest } from "next/server";

import { ok, handleError } from "@/lib/http";
import { registerSchema } from "@/schemas/user.schema";
import { register } from "@/services/user.service";

/**
 * Self-registration. The account is created PENDING and no session cookie is
 * issued — the user can sign in only after an admin approves the account.
 */
export async function POST(req: NextRequest) {
  try {
    const input = registerSchema.parse(await req.json());
    const { user } = await register(input);
    return ok({ user, pending: true }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
