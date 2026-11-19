/**
 * CLI: apply pending migrations from ./drizzle to DATABASE_URL.
 *   npm run db:migrate
 * Creates the database first if it doesn't exist (fresh local checkouts).
 * The runner itself lives in ./migrations.
 */
import "dotenv/config";
import { join, resolve } from "node:path";

import { ensureDatabaseExists } from "./ensure-db";
import { runMigrations } from "./migrations";

const migrationsDir = join(resolve(import.meta.dirname, "../.."), "drizzle");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  // Bootstrap: create the database if it doesn't exist yet, so a fresh
  // checkout can run `db:migrate` without a manual CREATE DATABASE step.
  await ensureDatabaseExists(url);
  await runMigrations(url, migrationsDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
