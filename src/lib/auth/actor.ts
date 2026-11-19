import { getUserById, USER_NOT_FOUND } from "@/services/user.service";
import { getSessionUserId } from "./session";
import { ApiError } from "../http";
import type { Actor } from "./permissions";

/**
 * Resolves the full session user, or null when there is no session or the
 * session points at a user that no longer exists (e.g. DB reset or a deleted
 * account). Pages use this instead of throwing so a stale-but-validly-signed
 * cookie degrades to "please log in" rather than a 500.
 *
 * Only ACTIVE accounts have a session: an account that is pending approval or
 * was rejected (even one holding an older, validly signed cookie) is treated
 * as logged out.
 */
export async function getSessionUser() {
  const uid = await getSessionUserId();
  if (!uid) return null;
  try {
    const user = await getUserById(uid);
    return user.status === "ACTIVE" ? user : null;
  } catch (err) {
    if (err instanceof ApiError && err.code === USER_NOT_FOUND) return null;
    throw err;
  }
}

/** Resolves the authenticated actor or throws 401. */
export async function requireActor(): Promise<Actor> {
  const user = await getSessionUser();
  if (!user) throw new ApiError("UNAUTHENTICATED", "Please log in", 401);
  return { id: user.id, role: user.role };
}

/** Resolves the actor, or null when not authenticated. */
export async function getActorOrNull(): Promise<Actor | null> {
  const user = await getSessionUser();
  return user ? { id: user.id, role: user.role } : null;
}
