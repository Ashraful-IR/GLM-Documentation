/**
 * "CREATE DATABASE if not exists" for the DATABASE_URL target. Side-effect
 * free (no dotenv, no CLI) so it can be imported by bundled entry points.
 */
import postgres from "postgres";

export type EnsureDbResult = "created" | "exists";

export async function ensureDatabaseExists(url: string): Promise<EnsureDbResult> {
  const parsed = new URL(url);
  const targetDbName = parsed.pathname.replace(/^\//, "");
  if (!targetDbName) {
    throw new Error("DATABASE_URL is missing a database name");
  }

  // Connect to the default maintenance database to check/create the target one.
  parsed.pathname = "/postgres";
  const client = postgres(parsed.toString(), { max: 1, onnotice: () => {} });
  try {
    const rows = await client`
      SELECT datname FROM pg_catalog.pg_database WHERE datname = ${targetDbName}
    `;
    if (rows.length === 0) {
      console.log(`Database '${targetDbName}' does not exist. Creating...`);
      // DDL can't take bind parameters; escape embedded quotes in the name.
      await client.unsafe(`CREATE DATABASE "${targetDbName.replace(/"/g, '""')}"`);
      console.log(`Database '${targetDbName}' created successfully.`);
      return "created";
    }
    console.log(`Database '${targetDbName}' already exists.`);
    return "exists";
  } finally {
    await client.end();
  }
}
