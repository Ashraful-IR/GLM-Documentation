/**
 * Minimal, deterministic migration runner.
 *
 * Applies every `drizzle/*.sql` file in filename order, tracking applied
 * migrations in `documentation.__migrations`. Each migration runs inside its
 * own transaction.
 *
 * Hand-written SQL is used (instead of drizzle-kit) because the schema uses
 * PostgreSQL features drizzle-kit introspects poorly: `ltree` columns, GIN
 * indexes on `to_tsvector`, and enums in a non-public schema.
 *
 * Side-effect free: used by the `db:migrate` CLI (./migrate.ts) and by the
 * bundled deploy step (./deploy.ts) that runs when the container starts.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

/** Arbitrary constant: serializes concurrent migrators (e.g. replicas booting together). */
const MIGRATION_LOCK_ID = 727_001;

export async function runMigrations(url: string, migrationsDir: string): Promise<number> {
  // max: 1 → every statement (including the advisory lock) uses one session.
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await client`SELECT pg_advisory_lock(${MIGRATION_LOCK_ID})`;

    await client`
      CREATE SCHEMA IF NOT EXISTS documentation
    `;
    await client`
      CREATE TABLE IF NOT EXISTS documentation.__migrations (
        id         SERIAL PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;

    // Self-heal: ltree must live in `public` so app connections (which use the
    // default search_path and cast `::ltree` in raw SQL) can resolve the type.
    // Early 0000_init.sql versions installed it into `documentation` via
    // `SET search_path`; normalize such installs on every migrate run.
    const [ltreeExt] = await client`
      SELECT e.extnamespace, n.nspname AS schema
      FROM pg_extension e
      JOIN pg_namespace n ON n.oid = e.extnamespace
      WHERE e.extname = 'ltree'
    `;
    if (ltreeExt && ltreeExt.schema !== "public") {
      await client.unsafe("ALTER EXTENSION ltree SET SCHEMA public");
      console.log("  moved ltree extension into schema public");
    }

    const applied = new Set(
      (
        await client`
          SELECT name FROM documentation.__migrations ORDER BY id
        `
      ).map((r) => r.name as string),
    );

    const files = (await readdir(migrationsDir))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    let count = 0;
    for (const file of files) {
      if (applied.has(file)) continue;
      const sqlText = await readFile(join(migrationsDir, file), "utf8");
      await client.begin(async (tx) => {
        await tx.unsafe(sqlText);
        await tx`
          INSERT INTO documentation.__migrations (name) VALUES (${file})
        `;
      });
      console.log(`  applied ${file}`);
      count++;
    }
    console.log(count === 0 ? "Database is up to date." : `Applied ${count} migration(s).`);
    return count;
  } finally {
    await client`SELECT pg_advisory_unlock(${MIGRATION_LOCK_ID})`.catch(() => {});
    await client.end();
  }
}
