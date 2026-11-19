/**
 * Ensures the DATABASE_URL database exists, creating it if needed.
 *
 * Run standalone:  npm run db:create
 * The logic lives in ./ensure-db (side-effect free, safe to bundle).
 */
import "dotenv/config";
import { pathToFileURL } from "node:url";

import { ensureDatabaseExists } from "./ensure-db";

export { ensureDatabaseExists, type EnsureDbResult } from "./ensure-db";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set in .env");
    process.exit(1);
  }
  try {
    await ensureDatabaseExists(url);
  } catch (error) {
    console.error("Error checking/creating database:");
    console.error(error);
    process.exit(1);
  }
}

// Run only when invoked directly (`npm run db:create`), not when imported.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
