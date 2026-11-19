/**
 * Teams and designations: two identical admin-managed lookup lists that users
 * pick from at registration. One implementation, parameterised by table.
 */
import { asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { designations, teams, users } from "@/db/schema";
import { PERMISSIONS, requirePermission, type Actor } from "@/lib/auth/permissions";
import { ApiError } from "@/lib/http";
import { logAudit } from "./audit.service";

export type LookupKind = "team" | "designation";

const CONFIG = {
  team: { table: teams, userColumn: users.teamId, label: "Team" },
  designation: { table: designations, userColumn: users.designationId, label: "Designation" },
} as const;

export interface LookupItem {
  id: string;
  name: string;
  userCount: number;
}

/** Postgres error code from a driver error, unwrapping Drizzle's wrapper. */
function pgCode(err: unknown): string | undefined {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code ?? e?.cause?.code;
}

export async function listLookup(kind: LookupKind): Promise<LookupItem[]> {
  const { table, userColumn } = CONFIG[kind];
  // A join (not a correlated subquery): Drizzle renders columns unqualified in
  // single-table selects, which would make `team_id = id` compare users to users.
  const rows = await db
    .select({
      id: table.id,
      name: table.name,
      userCount: sql<number>`count(${users.id})::int`,
    })
    .from(table)
    .leftJoin(users, eq(userColumn, table.id))
    .groupBy(table.id, table.name)
    .orderBy(asc(sql`lower(${table.name})`));
  return rows;
}

/** Throws 400 unless a row with this id exists. */
export async function assertLookupExists(kind: LookupKind, id: string): Promise<void> {
  const { table, label } = CONFIG[kind];
  const [row] = await db.select({ id: table.id }).from(table).where(eq(table.id, id)).limit(1);
  if (!row) throw new ApiError(`INVALID_${kind.toUpperCase()}`, `${label} not found`, 400);
}

export async function createLookup(actor: Actor, kind: LookupKind, name: string): Promise<LookupItem> {
  requirePermission(actor, PERMISSIONS.MANAGE_USERS);
  const { table, label } = CONFIG[kind];
  try {
    const [row] = await db.insert(table).values({ name: name.trim() }).returning();
    await logAudit(actor, { action: `${kind.toUpperCase()}_CREATED`, entityType: kind, entityId: row.id, metadata: { name: row.name } });
    return { id: row.id, name: row.name, userCount: 0 };
  } catch (err) {
    if (pgCode(err) === "23505") throw new ApiError("NAME_TAKEN", `${label} "${name.trim()}" already exists`, 409);
    throw err;
  }
}

export async function renameLookup(actor: Actor, kind: LookupKind, id: string, name: string): Promise<{ id: string; name: string }> {
  requirePermission(actor, PERMISSIONS.MANAGE_USERS);
  const { table, label } = CONFIG[kind];
  try {
    const [row] = await db.update(table).set({ name: name.trim() }).where(eq(table.id, id)).returning();
    if (!row) throw new ApiError("NOT_FOUND", `${label} not found`, 404);
    await logAudit(actor, { action: `${kind.toUpperCase()}_RENAMED`, entityType: kind, entityId: id, metadata: { name: row.name } });
    return { id: row.id, name: row.name };
  } catch (err) {
    if (pgCode(err) === "23505") throw new ApiError("NAME_TAKEN", `${label} "${name.trim()}" already exists`, 409);
    throw err;
  }
}

export async function deleteLookup(actor: Actor, kind: LookupKind, id: string): Promise<{ deleted: true }> {
  requirePermission(actor, PERMISSIONS.MANAGE_USERS);
  const { table, userColumn, label } = CONFIG[kind];
  const [inUse] = await db.select({ id: users.id }).from(users).where(eq(userColumn, id)).limit(1);
  if (inUse) {
    throw new ApiError("IN_USE", `${label} is assigned to users — reassign them before deleting`, 409);
  }
  try {
    const [row] = await db.delete(table).where(eq(table.id, id)).returning({ id: table.id, name: table.name });
    if (!row) throw new ApiError("NOT_FOUND", `${label} not found`, 404);
    await logAudit(actor, { action: `${kind.toUpperCase()}_DELETED`, entityType: kind, entityId: id, metadata: { name: row.name } });
    return { deleted: true };
  } catch (err) {
    // Race: a user was assigned between the check and the delete (FK RESTRICT).
    if (pgCode(err) === "23503") {
      throw new ApiError("IN_USE", `${label} is assigned to users — reassign them before deleting`, 409);
    }
    throw err;
  }
}
