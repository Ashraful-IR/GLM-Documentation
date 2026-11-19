import { asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/db";
import { designations, teams, users, type UserRow, type UserStatus } from "@/db/schema";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken } from "@/lib/auth/token";
import { PERMISSIONS, requirePermission, type Actor, type UserRole } from "@/lib/auth/permissions";
import { ApiError } from "@/lib/http";
import { logAudit } from "./audit.service";
import { assertLookupExists } from "./lookup.service";

const EMAIL_TAKEN = "EMAIL_TAKEN";
const INVALID_CREDENTIALS = "INVALID_CREDENTIALS";
export const USER_NOT_FOUND = "USER_NOT_FOUND";
export const ACCOUNT_PENDING = "ACCOUNT_PENDING";
export const ACCOUNT_REJECTED = "ACCOUNT_REJECTED";

interface NewAccountInput {
  name: string;
  email: string;
  password: string;
  teamId: string;
  designationId: string;
}

async function assertEmailFree(email: string) {
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    throw new ApiError(EMAIL_TAKEN, "An account with this email already exists", 409);
  }
}

async function assertProfileRefs(input: { teamId?: string; designationId?: string }) {
  if (input.teamId) await assertLookupExists("team", input.teamId);
  if (input.designationId) await assertLookupExists("designation", input.designationId);
}

/**
 * Self-registration. The account is created PENDING and gets NO session:
 * the user can only sign in after an admin approves it.
 */
export async function register(input: NewAccountInput) {
  const email = input.email.trim().toLowerCase();
  await assertEmailFree(email);
  await assertProfileRefs(input);
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({
      name: input.name.trim(),
      email,
      passwordHash,
      role: "VIEWER",
      status: "PENDING",
      teamId: input.teamId,
      designationId: input.designationId,
    })
    .returning();
  await logAudit({ id: user.id }, { action: "USER_REGISTERED", entityType: "user", entityId: user.id, metadata: { email } });
  return { user: publicUser(user) };
}

/** Admin-created account: active immediately, with the role the admin chose. */
export async function createUserByAdmin(actor: Actor, input: NewAccountInput & { role: UserRole }) {
  requirePermission(actor, PERMISSIONS.MANAGE_USERS);
  const email = input.email.trim().toLowerCase();
  await assertEmailFree(email);
  await assertProfileRefs(input);
  const passwordHash = await hashPassword(input.password);
  const [user] = await db
    .insert(users)
    .values({
      name: input.name.trim(),
      email,
      passwordHash,
      role: input.role,
      status: "ACTIVE",
      teamId: input.teamId,
      designationId: input.designationId,
      approvedBy: actor.id,
      approvedAt: new Date(),
    })
    .returning();
  await logAudit(actor, { action: "USER_CREATED", entityType: "user", entityId: user.id, metadata: { email, role: input.role } });
  return publicUser(user);
}

export async function login(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    // Same error for unknown email vs bad password — no account enumeration.
    throw new ApiError(INVALID_CREDENTIALS, "Invalid email or password", 401);
  }
  // Status is only revealed after the password is verified.
  if (user.status === "PENDING") {
    throw new ApiError(ACCOUNT_PENDING, "Your account is awaiting admin approval", 403);
  }
  if (user.status === "REJECTED") {
    throw new ApiError(ACCOUNT_REJECTED, "Your registration was not approved. Contact an administrator.", 403);
  }
  return { user: publicUser(user), token: createSessionToken(user.id) };
}

export async function getUserById(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  if (!user) throw new ApiError(USER_NOT_FOUND, "User not found", 404);
  return user;
}

export function publicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    teamId: user.teamId,
    designationId: user.designationId,
    avatarUrl: user.avatarUrl,
  };
}

const approver = alias(users, "approver");

/** Full user list (admin), with team/designation names; optional status filter. */
export async function listUsers(actor: Actor, filter: { status?: UserStatus } = {}) {
  requirePermission(actor, PERMISSIONS.MANAGE_USERS);
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      avatarUrl: users.avatarUrl,
      teamId: users.teamId,
      teamName: teams.name,
      designationId: users.designationId,
      designationName: designations.name,
      approvedByName: approver.name,
      approvedAt: users.approvedAt,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(teams, eq(teams.id, users.teamId))
    .leftJoin(designations, eq(designations.id, users.designationId))
    .leftJoin(approver, eq(approver.id, users.approvedBy))
    .where(filter.status ? eq(users.status, filter.status) : undefined)
    .orderBy(asc(users.createdAt));
  return rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
  }));
}

export async function updateUserRole(actor: Actor, userId: string, role: UserRole) {
  requirePermission(actor, PERMISSIONS.MANAGE_USERS);
  if (actor.id === userId && role !== "ADMIN") {
    throw new ApiError("CANNOT_DEMOTE_SELF", "You cannot remove your own admin role", 400);
  }
  const [updated] = await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw new ApiError(USER_NOT_FOUND, "User not found", 404);
  return publicUser(updated);
}

/** Approve (ACTIVE) or reject (REJECTED) an account. */
export async function setUserStatus(actor: Actor, userId: string, status: "ACTIVE" | "REJECTED") {
  requirePermission(actor, PERMISSIONS.MANAGE_USERS);
  if (actor.id === userId) {
    throw new ApiError("CANNOT_CHANGE_OWN_STATUS", "You cannot change your own account status", 400);
  }
  const [updated] = await db
    .update(users)
    .set(
      status === "ACTIVE"
        ? { status, approvedBy: actor.id, approvedAt: new Date(), updatedAt: new Date() }
        : { status, approvedBy: null, approvedAt: null, updatedAt: new Date() },
    )
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw new ApiError(USER_NOT_FOUND, "User not found", 404);
  await logAudit(actor, {
    action: status === "ACTIVE" ? "USER_APPROVED" : "USER_REJECTED",
    entityType: "user",
    entityId: userId,
    metadata: { email: updated.email },
  });
  return publicUser(updated);
}

/** Admin edit of another user's team / designation (e.g. to fill in pre-existing users). */
export async function updateUserProfileByAdmin(
  actor: Actor,
  userId: string,
  input: { name?: string; teamId?: string; designationId?: string },
) {
  requirePermission(actor, PERMISSIONS.MANAGE_USERS);
  await assertProfileRefs(input);
  const [updated] = await db
    .update(users)
    .set({
      ...(input.name ? { name: input.name.trim() } : {}),
      ...(input.teamId ? { teamId: input.teamId } : {}),
      ...(input.designationId ? { designationId: input.designationId } : {}),
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();
  if (!updated) throw new ApiError(USER_NOT_FOUND, "User not found", 404);
  return publicUser(updated);
}

export async function updateProfile(actorId: string, input: { name?: string }) {
  const [updated] = await db
    .update(users)
    .set({
      ...(input.name ? { name: input.name.trim() } : {}),
      updatedAt: sql`now()`,
    })
    .where(eq(users.id, actorId))
    .returning();
  if (!updated) throw new ApiError(USER_NOT_FOUND, "User not found", 404);
  return publicUser(updated);
}

/** Team / designation names for the signed-in user's own profile. */
export async function getProfileNames(user: Pick<UserRow, "teamId" | "designationId">) {
  const [team] = user.teamId
    ? await db.select({ name: teams.name }).from(teams).where(eq(teams.id, user.teamId)).limit(1)
    : [];
  const [designation] = user.designationId
    ? await db.select({ name: designations.name }).from(designations).where(eq(designations.id, user.designationId)).limit(1)
    : [];
  return { teamName: team?.name ?? null, designationName: designation?.name ?? null };
}
