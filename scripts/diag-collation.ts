/**
 * Diagnostic for migration 0004 (sort_key COLLATE "C").
 *
 * Demonstrates why the fractional sort_key column must NOT use the database
 * default collation: on en_US.UTF-8, PostgreSQL orders text case-insensitively
 * at the primary level (b2 < C0 < c7), while the fractional-index algorithm
 * and every JS sort use byte order (C0 < D6 < ... < b2 < c7). This script
 * compares the two orderings over a real rebalanceKeys(60) key set and
 * reports the disagreements. Run against a default-collated column, ~47 of
 * 60 positions disagree — which is what broke test-navigation.ts's stress
 * test before 0004.
 *
 * Note: it deliberately compares against the DEFAULT collation (via array
 * literals, not the navigation column), so it keeps demonstrating the issue
 * even after 0004 made the actual column byte-ordered.
 *
 * Run: npx tsx scripts/diag-collation.ts
 */
import "dotenv/config";

import { getDb } from "../src/db";
import { rebalanceKeys } from "../src/lib/utils/fractional-index";

async function main() {
  const { client } = getDb();

  // Fresh 60-key rebalance — same key set the stress test produces.
  const keys = rebalanceKeys(60);

  // postgres.js serializes JS arrays to Postgres array literals automatically.
  const pgRows = await client`SELECT k FROM unnest(${keys}::text[]) AS t(k) ORDER BY k`;
  const pgList = pgRows.map((r) => r.k as string);
  const jsList = [...keys].sort();

  let mismatches = 0;
  for (let i = 0; i < jsList.length; i++) {
    if (jsList[i] !== pgList[i]) {
      mismatches++;
      if (mismatches <= 5) console.log(`position ${i}: JS=${jsList[i]}  PG=${pgList[i]}`);
    }
  }
  console.log(`\n${mismatches}/${jsList.length} positions disagree between JS byte order and PG default collation`);

  // Minimal demonstration with two real keys.
  const lower = jsList.find((k) => /^[a-z]/.test(k));
  const upper = jsList.find((k) => /^[A-Z]/.test(k));
  if (lower && upper) {
    const [cmp] = await client`SELECT (${upper} < ${lower}) AS pg_default, (${upper} < ${lower} COLLATE "C") AS pg_c`;
    console.log(`\nexample: JS byte order says "${upper}" < "${lower}"`);
    console.log(`         PG default collation agrees: ${cmp.pg_default}   COLLATE "C" agrees: ${cmp.pg_c}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
