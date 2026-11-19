/**
 * Integration tests for registration approval, admin-created users and the
 * team / designation lists (user.service.ts + lookup.service.ts).
 * Run: npm run db:start && npx tsx scripts/test-user-approval.ts
 *
 * Expects a seeded database (npm run db:seed). Creates its own uniquely named
 * users / teams / designations and deletes them afterwards.
 */
import "dotenv/config";
// login() signs a session token; the tokens here never leave this process.
process.env.AUTH_SECRET ??= "test-user-approval-secret";
import { eq, inArray } from "drizzle-orm";

import { db } from "../src/db";
import { auditLogs, designations, teams, users } from "../src/db/schema";
import { ApiError } from "../src/lib/http";
import * as lookups from "../src/services/lookup.service";
import * as userService from "../src/services/user.service";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  } else {
    console.log("  ok:", msg);
  }
}

/** Runs fn and returns the ApiError code/status it throws (or null if it doesn't). */
async function apiError(fn: () => Promise<unknown>): Promise<{ code: string; status: number } | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    if (err instanceof ApiError) return { code: err.code, status: err.status };
    throw err;
  }
}

const tag = `t${Date.now().toString(36)}`;
const createdUserIds: string[] = [];
const createdTeamIds: string[] = [];
const createdDesignationIds: string[] = [];

async function main() {
  const [admin] = await db.select().from(users).where(eq(users.email, "admin@local.dev")).limit(1);
  if (!admin) throw new Error("Seed the database first (npm run db:seed)");
  const adminActor = { id: admin.id, role: "ADMIN" as const };

  // --- Lookup lists ---------------------------------------------------------
  const team = await lookups.createLookup(adminActor, "team", `QA ${tag}`);
  createdTeamIds.push(team.id);
  const designation = await lookups.createLookup(adminActor, "designation", `Tester ${tag}`);
  createdDesignationIds.push(designation.id);
  check((await lookups.listLookup("team")).some((t) => t.id === team.id), "created team appears in list");

  const dupTeam = await apiError(() => lookups.createLookup(adminActor, "team", `qa ${tag.toUpperCase()}`));
  check(dupTeam?.status === 409 && dupTeam.code === "NAME_TAKEN", "team names are unique case-insensitively (409)");

  // --- Self-registration → PENDING, cannot log in ----------------------------
  const email = `pending-${tag}@example.com`;
  const password = "s3cret-pass";
  const registered = await userService.register({
    name: "Pending Person",
    email,
    password,
    teamId: team.id,
    designationId: designation.id,
  });
  const reg = registered.user;
  createdUserIds.push(reg.id);
  check(reg.status === "PENDING", "self-registered user starts PENDING");
  check(reg.role === "VIEWER", "self-registered user is a VIEWER");
  check(!("token" in registered), "register issues no session token");

  const pendingLogin = await apiError(() => userService.login({ email, password }));
  check(pendingLogin?.status === 403 && pendingLogin.code === "ACCOUNT_PENDING", "pending user login → 403 ACCOUNT_PENDING");

  const wrongPw = await apiError(() => userService.login({ email, password: "wrong-password" }));
  check(wrongPw?.code === "INVALID_CREDENTIALS", "wrong password reveals nothing about pending status");

  const dupEmail = await apiError(() =>
    userService.register({ name: "Dup", email: email.toUpperCase(), password, teamId: team.id, designationId: designation.id }),
  );
  check(dupEmail?.status === 409 && dupEmail.code === "EMAIL_TAKEN", "duplicate email (any case) → 409");

  const badTeam = await apiError(() =>
    userService.register({
      name: "Bad",
      email: `bad-${tag}@example.com`,
      password,
      teamId: "00000000-0000-4000-8000-000000000000",
      designationId: designation.id,
    }),
  );
  check(badTeam?.status === 400 && badTeam.code === "INVALID_TEAM", "unknown team id → 400");

  const pendingList = await userService.listUsers(adminActor, { status: "PENDING" });
  const row = pendingList.find((u) => u.id === reg.id);
  check(!!row && row.teamName === team.name && row.designationName === designation.name, "pending list includes team/designation names");

  // --- Approve → can log in --------------------------------------------------
  const approved = await userService.setUserStatus(adminActor, reg.id, "ACTIVE");
  check(approved.status === "ACTIVE", "approve sets ACTIVE");
  const [approvedRow] = await db.select().from(users).where(eq(users.id, reg.id));
  check(approvedRow.approvedBy === admin.id && approvedRow.approvedAt !== null, "approval records approver and time");
  const loginOk = await userService.login({ email, password });
  check(typeof loginOk.token === "string" && loginOk.token.length > 0, "approved user can log in");

  // --- Reject → cannot log in ------------------------------------------------
  await userService.setUserStatus(adminActor, reg.id, "REJECTED");
  const rejectedLogin = await apiError(() => userService.login({ email, password }));
  check(rejectedLogin?.status === 403 && rejectedLogin.code === "ACCOUNT_REJECTED", "rejected user login → 403 ACCOUNT_REJECTED");
  const selfStatus = await apiError(() => userService.setUserStatus(adminActor, admin.id, "REJECTED"));
  check(selfStatus?.code === "CANNOT_CHANGE_OWN_STATUS", "admin cannot change own status");

  // --- Admin-created user → ACTIVE immediately -------------------------------
  const created = await userService.createUserByAdmin(adminActor, {
    name: "Created By Admin",
    email: `created-${tag}@example.com`,
    password,
    role: "EDITOR",
    teamId: team.id,
    designationId: designation.id,
  });
  createdUserIds.push(created.id);
  check(created.status === "ACTIVE" && created.role === "EDITOR", "admin-created user is ACTIVE with chosen role");
  const createdLogin = await userService.login({ email: `created-${tag}@example.com`, password });
  check(!!createdLogin.token, "admin-created user can log in immediately");

  // --- Permissions -----------------------------------------------------------
  const editorActor = { id: created.id, role: "EDITOR" as const };
  const forbidden = await Promise.all([
    apiError(() => userService.listUsers(editorActor)),
    apiError(() => userService.setUserStatus(editorActor, reg.id, "ACTIVE")),
    apiError(() =>
      userService.createUserByAdmin(editorActor, {
        name: "x",
        email: `x-${tag}@example.com`,
        password,
        role: "ADMIN",
        teamId: team.id,
        designationId: designation.id,
      }),
    ),
    apiError(() => lookups.createLookup(editorActor, "team", `nope ${tag}`)),
    apiError(() => lookups.deleteLookup(editorActor, "team", team.id)),
  ]);
  check(forbidden.every((e) => e?.status === 403), "non-admin is forbidden from every admin action (403)");

  // --- Lookup in use cannot be deleted; rename works -------------------------
  const counted = (await lookups.listLookup("team")).find((t) => t.id === team.id);
  check(counted?.userCount === 2, `team user count reflects assigned users (got ${counted?.userCount})`);

  const inUse = await apiError(() => lookups.deleteLookup(adminActor, "team", team.id));
  check(inUse?.status === 409 && inUse.code === "IN_USE", "deleting a team that is assigned → 409 IN_USE");
  const renamed = await lookups.renameLookup(adminActor, "team", team.id, `QA renamed ${tag}`);
  check(renamed.name === `QA renamed ${tag}`, "rename team");

  // --- Admin edits a user's team/designation ---------------------------------
  const team2 = await lookups.createLookup(adminActor, "team", `Ops ${tag}`);
  createdTeamIds.push(team2.id);
  const edited = await userService.updateUserProfileByAdmin(adminActor, created.id, { teamId: team2.id });
  check(edited.teamId === team2.id && edited.designationId === designation.id, "admin can change a user's team only");

  // --- Pre-existing users stay ACTIVE (migration default) --------------------
  check(admin.status === "ACTIVE", "seeded admin is ACTIVE");
}

async function cleanup() {
  const entityIds = [...createdUserIds, ...createdTeamIds, ...createdDesignationIds];
  if (entityIds.length) await db.delete(auditLogs).where(inArray(auditLogs.entityId, entityIds));
  if (createdUserIds.length) {
    await db.delete(auditLogs).where(inArray(auditLogs.userId, createdUserIds));
    await db.delete(users).where(inArray(users.id, createdUserIds));
  }
  if (createdTeamIds.length) await db.delete(teams).where(inArray(teams.id, createdTeamIds));
  if (createdDesignationIds.length) await db.delete(designations).where(inArray(designations.id, createdDesignationIds));
}

main()
  .then(async () => {
    await cleanup();
    if (failures > 0) {
      console.error(`\n${failures} check(s) failed`);
      process.exit(1);
    }
    console.log("\nAll user approval checks passed");
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await cleanup().catch(() => {});
    process.exit(1);
  });
