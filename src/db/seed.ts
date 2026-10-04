/**
 * Idempotent seed.
 *
 * Creates the local admin user (admin@local.dev / admin123) and a sample
 * documentation tree with a few documents. Safe to run repeatedly — it
 * only acts when the users or navigation tables are empty.
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

import { db } from "./index";
import { documents, navigation, users } from "./schema";
import { createNavigationTree } from "../services/navigation.service";
import { extractTextFromDoc } from "../lib/content/text";
import type { TiptapJson } from "./schema";

const SAMPLE_DOCS: Array<{ slug: string; title: string; content: TiptapJson }> = [
  {
    slug: "overview",
    title: "Overview",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Welcome to your documentation platform" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "This is a " },
            { type: "text", marks: [{ type: "bold" }], text: "local-first" },
            {
              type: "text",
              text: " documentation space. The navigation tree on the left mirrors the structure of your docs, and every page is written with a rich Tiptap editor.",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "What you can do" }],
        },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Create folders, documents, and external links" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Drag items to reorder or re-parent them — cycle-safe and transactional" }],
                },
              ],
            },
            {
              type: "listItem",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "Autosave drafts, publish versions, and restore from trash" }],
                },
              ],
            },
          ],
        },
        {
          type: "callout",
          attrs: { variant: "info" },
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Tip: type " },
                { type: "text", marks: [{ type: "code" }], text: "/" },
                { type: "text", text: " anywhere in the editor to insert headings, lists, code blocks, tables, callouts and more." },
              ],
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Edit this page" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Open the " },
            { type: "text", marks: [{ type: "code" }], text: "Edit" },
            { type: "text", text: " action in the navigation menu (⋮) to start writing." },
          ],
        },
      ],
    },
  },
  {
    slug: "frontend",
    title: "Frontend",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Frontend" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "The frontend is built with " },
            { type: "text", marks: [{ type: "code" }], text: "Next.js" },
            {
              type: "text",
              text: ", React, TypeScript, and Tailwind CSS. UI primitives come from shadcn/ui; the editor is Tiptap.",
            },
          ],
        },
        {
          type: "codeBlock",
          attrs: { language: "tsx" },
          content: [{ type: "text", text: "// A document is stored as Tiptap JSON\nexport interface TiptapJson {\n  type: 'doc';\n  content?: TiptapNode[];\n}" }],
        },
        {
          type: "table",
          attrs: { isHeaderRow: true },
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "Layer" }] }] },
                { type: "tableHeader", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "Responsibility" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "Components" }] }] },
                { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "Tree, editor, viewer" }] }] },
              ],
            },
            {
              type: "tableRow",
              content: [
                { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "Services" }] }] },
                { type: "tableCell", attrs: { colspan: 1, rowspan: 1, colwidth: null }, content: [{ type: "paragraph", content: [{ type: "text", text: "Validation + DB access" }] }] },
              ],
            },
          ],
        },
      ],
    },
  },
  {
    slug: "backend",
    title: "Backend",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Backend" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Next.js Route Handlers expose a typed API. Business logic lives in services, each of which validates input, checks permissions, and talks to PostgreSQL via Drizzle." },
          ],
        },
        {
          type: "blockquote",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Database access flows through the service layer — never from UI components." }],
            },
          ],
        },
      ],
    },
  },
  {
    slug: "database",
    title: "Database",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Database" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "PostgreSQL holds the six core tables. The navigation tree uses an " },
            { type: "text", marks: [{ type: "code" }], text: "ltree" },
            {
              type: "text",
              text: " materialized path for cheap subtree and cycle queries, and a fractional sort key for O(1) reordering.",
            },
          ],
        },
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Schema" }],
        },
        {
          type: "orderedList",
          attrs: { start: 1 },
          content: [
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "users" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "navigation" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "documents" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "document_versions" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "media" }] }] },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "audit_logs" }] }] },
          ],
        },
      ],
    },
  },
  {
    slug: "deployment",
    title: "Deployment",
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Deployment" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "The platform runs entirely locally: " },
            { type: "text", marks: [{ type: "code" }], text: "http://localhost:3000" },
            { type: "text", text: " talks to a local PostgreSQL instance. No cloud infrastructure is required." },
          ],
        },
      ],
    },
  },
];

async function main() {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing.length === 0) {
    const passwordHash = await bcrypt.hash("admin123", 10);
    const [admin] = await db
      .insert(users)
      .values({
        email: "admin@local.dev",
        name: "Administrator",
        passwordHash,
        role: "ADMIN",
      })
      .returning({ id: users.id });
    console.log(`  created admin user (${admin.id})`);
  } else {
    console.log("  users already seeded — skipping");
  }

  const navCount = await db
    .select({ id: navigation.id })
    .from(navigation)
    .limit(1);
  if (navCount.length > 0) {
    console.log("  navigation already seeded — skipping");
    // The shared postgres pool in db/index.ts keeps idle sockets open; without
    // an explicit exit the process would hang here after main() resolves.
    process.exit(0);
  }

  const admin = await db
    .select()
    .from(users)
    .where(eq(users.email, "admin@local.dev"))
    .limit(1);
  if (admin.length === 0) {
    throw new Error("Admin user missing after seed — cannot build sample tree");
  }
  const adminId = admin[0].id;

  // Documents first (navigation references them).
  const docBySlug = new Map<string, string>();
  for (const sample of SAMPLE_DOCS) {
    const [doc] = await db
      .insert(documents)
      .values({
        title: sample.title,
        content: sample.content,
        contentText: extractTextFromDoc(sample.content),
        status: "PUBLISHED",
        currentVersion: 1,
        createdBy: adminId,
        updatedBy: adminId,
        publishedBy: adminId,
        publishedAt: new Date(),
        publishedTitle: sample.title,
        publishedContent: sample.content,
      })
      .returning({ id: documents.id });
    docBySlug.set(sample.slug, doc.id);
  }

  await createNavigationTree(
    { id: adminId, role: "ADMIN" },
    [
      { title: "Overview", slug: "overview", type: "DOCUMENT", documentId: docBySlug.get("overview")! },
      {
        title: "Architecture",
        slug: "architecture",
        type: "FOLDER",
        children: [
          { title: "Frontend", slug: "frontend", type: "DOCUMENT", documentId: docBySlug.get("frontend")! },
          { title: "Backend", slug: "backend", type: "DOCUMENT", documentId: docBySlug.get("backend")! },
          { title: "Database", slug: "database", type: "DOCUMENT", documentId: docBySlug.get("database")! },
        ],
      },
      { title: "Deployment", slug: "deployment", type: "DOCUMENT", documentId: docBySlug.get("deployment")! },
    ],
    { audit: true, log: (msg) => console.log(`  ${msg}`) },
  );

  console.log("Seed complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
