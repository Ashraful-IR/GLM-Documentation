/**
 * Verifies large documents save correctly (the 1MB tsvector regression).
 *
 * PostgreSQL's GIN full-text index throws "string is too long for tsvector"
 * when content_text exceeds ~1MB, which used to fail every save of a large
 * document. The service now caps content_text (MAX_INDEXABLE_TEXT_BYTES) so
 * saves always succeed while search coverage stays bounded.
 *
 * Run: npx tsx scripts/test-large-doc.ts
 * (starts with .env.dev DATABASE_URL; expects a seeded database)
 */
import "dotenv/config";

import { eq, sql } from "drizzle-orm";

import { db } from "../src/db";
import { documents, users } from "../src/db/schema";
import * as docs from "../src/services/document.service";
import { updateDocumentSchema } from "../src/schemas/document.schema";
import type { TiptapJson } from "../src/db/schema";

let failures = 0;
function check(cond: boolean, msg: string) {
  if (!cond) {
    failures++;
    console.error("FAIL:", msg);
  }
}

/** Builds a Tiptap doc with `paragraphs` unique paragraphs of `words` words each. */
function makeDoc(paragraphs: number, wordsPerPara: number): TiptapJson {
  const content = Array.from({ length: paragraphs }, (_, i) => ({
    type: "paragraph",
    content: [
      {
        type: "text",
        text: `para-${i} ` + Array.from({ length: wordsPerPara }, (_, w) => `w${i}_${w}`).join(" "),
      },
    ],
  }));
  return { type: "doc", content };
}

function textBytesOf(content: TiptapJson): number {
  let text = "";
  const walk = (nodes?: TiptapJson["content"]) => {
    for (const n of nodes ?? []) {
      if (n.type === "text") text += n.text ?? "";
      walk(n.content as TiptapJson["content"] | undefined);
    }
  };
  walk(content.content);
  return Buffer.byteLength(text, "utf8");
}

async function main() {
  const [admin] = await db.select().from(users).where(eq(users.email, "admin@local.dev")).limit(1);
  if (!admin) throw new Error("Seed the database first (npm run db:seed)");
  const actor = { id: admin.id, role: "ADMIN" as const };

  const created: string[] = [];
  const sizes: Array<[string, number, number]> = [
    // [label, paragraphs, words per paragraph] — ~10 bytes per word
    ["~1MB text (old failure point)", 1400, 75],
    ["~5MB text", 6700, 75],
    ["~11MB text (near payload cap)", 11000, 75],
  ];

  for (const [label, paras, words] of sizes) {
    const content = makeDoc(paras, words);
    const approxMB = (textBytesOf(content) / 1024 / 1024).toFixed(2);
    const t0 = Date.now();
    const doc = await docs.createDocument(actor, { title: `Large-doc test — ${label}` });
    created.push(doc.id);

    // Autosave path (§13): this is the operation that used to fail.
    await docs.updateDocumentContent(actor, doc.id, { content });
    const ms = Date.now() - t0;

    const [row] = await db
      .select({ contentText: documents.contentText, content: documents.content })
      .from(documents)
      .where(eq(documents.id, doc.id))
      .limit(1);

    const storedText = row?.contentText ?? "";
    check(row?.content != null, `${label}: content stored`);
    check(
      Buffer.byteLength(storedText, "utf8") > 0 && Buffer.byteLength(storedText, "utf8") <= 500_010,
      `${label}: content_text capped at 500k bytes (got ${Buffer.byteLength(storedText, "utf8")})`,
    );
    check(storedText.endsWith("…"), `${label}: truncated text marked with ellipsis`);
    console.log(`OK: ${label} — ${approxMB}MB text saved in ${ms}ms (content_text capped, index intact)`);
  }

  // The Zod payload cap (route-level) rejects oversized JSON with a clear
  // error instead of letting a cryptic DB failure surface (service calls in
  // this script bypass Zod, so the cap is asserted against the schema).
  const oversized = updateDocumentSchema.safeParse({ content: makeDoc(26000, 75) }); // ≈17MB text → ~20MB JSON
  check(!oversized.success, "payload cap rejects a >16MB JSON document");
  if (!oversized.success) {
    check(
      oversized.error.issues.some((i) => i.message.startsWith("Document is too large")),
      "payload cap error message is the expected DOCUMENT_TOO_LARGE message",
    );
  }

  // Search still returns hits from the indexed prefix.
  const [first] = created;
  const hits = (await db.execute(
    // w0_1 sits in the first paragraph — well inside the indexed prefix.
    sql`SELECT id FROM documentation.documents
      WHERE id = ${first}::uuid
        AND to_tsvector('english', coalesce(content_text,'')) @@ plainto_tsquery('english', 'w0_1')`,
  )) as unknown as unknown[];
  check(hits.length === 1, "search index contains terms from the indexed prefix");

  // Cleanup.
  for (const id of created) await docs.hardDeleteDocument(actor, id);
  const left = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, created[0]));
  check(left.length === 0, "cleanup removed test documents");

  if (failures === 0) {
    console.log("\nAll large-document tests passed.");
  } else {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
