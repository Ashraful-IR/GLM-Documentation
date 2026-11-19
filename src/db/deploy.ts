/**
 * Deploy-time database step. Runs before the app starts (Docker CMD) and can
 * be run by hand with `npm run db:deploy`. Idempotent: safe on every boot.
 *
 *   1. Apply pending migrations from ./drizzle (serialized with an advisory
 *      lock, so replicas booting together don't race).
 *   2. Insert the starter teams / designations if those tables are empty.
 *   3. Bootstrap an admin from ADMIN_EMAIL / ADMIN_PASSWORD (+ ADMIN_NAME) if
 *      no account with that email exists. An existing account is never
 *      modified, so a password changed in the app survives redeploys.
 *
 * Exits non-zero on any failure, so the container never starts the app on a
 * half-migrated schema.
 *
 * Env:
 *   DATABASE_URL      required
 *   ADMIN_EMAIL       optional, with ADMIN_PASSWORD (set both or neither)
 *   ADMIN_PASSWORD    optional, min 8 characters
 *   ADMIN_NAME        optional, default "Administrator"
 *   RUN_MIGRATIONS    "false" skips the whole step (e.g. a DB-less smoke test)
 *   MIGRATIONS_DIR    default ./drizzle relative to the working directory
 */
import { join, resolve } from "node:path";
import postgres from "postgres";

import { hashPassword } from "../lib/auth/password";
import { emailSchema } from "../schemas/user.schema";
import { ensureDatabaseExists } from "./ensure-db";
import { runMigrations } from "./migrations";
import { STARTER_DESIGNATIONS, STARTER_TEAMS } from "./starter-lists";

const MIN_PASSWORD = 8;
/** Serializes the seed/admin step across replicas (distinct from the migration lock). */
const BOOTSTRAP_LOCK_ID = 727_002;

function log(msg: string) {
  console.log(`[db:deploy] ${msg}`);
}

/** Reads the optional admin settings; throws on a half-configured or invalid set. */
function adminConfig(): { email: string; password: string; name: string } | null {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email && !password) return null;
  if (!email || !password) {
    throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD (or neither)");
  }
  if (!emailSchema.safeParse(email).success) {
    throw new Error("ADMIN_EMAIL is not a valid email address");
  }
  if (password.length < MIN_PASSWORD) {
    throw new Error(`ADMIN_PASSWORD must be at least ${MIN_PASSWORD} characters`);
  }
  return { email, password, name: process.env.ADMIN_NAME?.trim() || "Administrator" };
}

async function seedStarterLists(sql: postgres.Sql) {
  for (const [table, names] of [
    ["teams", STARTER_TEAMS],
    ["designations", STARTER_DESIGNATIONS],
  ] as const) {
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ${sql("documentation")}.${sql(table)}
    `;
    if (count > 0) continue;
    await sql`
      INSERT INTO ${sql("documentation")}.${sql(table)} ${sql(names.map((name) => ({ name })))}
    `;
    log(`added ${names.length} starter ${table}`);
  }
}

async function ensureAdmin(sql: postgres.Sql, admin: { email: string; password: string; name: string }) {
  const existing = await sql`SELECT id FROM documentation.users WHERE email = ${admin.email} LIMIT 1`;
  if (existing.length > 0) {
    log(`admin ${admin.email} already exists, left unchanged`);
    return;
  }
  const passwordHash = await hashPassword(admin.password);
  // ON CONFLICT: another replica may have created it a moment ago.
  const inserted = await sql`
    INSERT INTO documentation.users (email, name, password_hash, role, status, approved_at)
    VALUES (${admin.email}, ${admin.name}, ${passwordHash}, 'ADMIN', 'ACTIVE', now())
    ON CONFLICT (email) DO NOTHING
    RETURNING id
  `;
  log(inserted.length ? `created admin ${admin.email}` : `admin ${admin.email} already exists, left unchanged`);
}

async function main() {
  if (process.env.RUN_MIGRATIONS === "false") {
    log("RUN_MIGRATIONS=false, skipping");
    return;
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const admin = adminConfig(); // validate before touching the database

  // Managed databases (Neon, RDS, …) often refuse connections to the
  // `postgres` maintenance DB; the target DB already exists there, so a
  // failure here is only a warning. A genuinely missing DB fails just below.
  await ensureDatabaseExists(url).catch((err: unknown) => {
    log(`could not check/create the database (${err instanceof Error ? err.message : err}); continuing`);
  });

  const migrationsDir = process.env.MIGRATIONS_DIR ?? join(resolve(process.cwd()), "drizzle");
  log(`migrating (${migrationsDir})`);
  await runMigrations(url, migrationsDir);

  // max: 1 → one session, so the advisory lock covers every statement below.
  // Without it, replicas booting together all see empty lists and all insert.
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`SELECT pg_advisory_lock(${BOOTSTRAP_LOCK_ID})`;
    await seedStarterLists(sql);
    if (admin) await ensureAdmin(sql, admin);
    else log("ADMIN_EMAIL not set, no admin bootstrap");
  } finally {
    await sql`SELECT pg_advisory_unlock(${BOOTSTRAP_LOCK_ID})`.catch(() => {});
    await sql.end();
  }
  log("done");
}

main().catch((err) => {
  console.error("[db:deploy] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
