import "dotenv/config";
import { ImportService } from "../src/services/import.service";
import { db } from "../src/db";
import { users, documents, documentVersions, navigation } from "../src/db/schema";
import { eq } from "drizzle-orm";
import type { Actor } from "../src/lib/auth/permissions";

const sampleMarkdown = `# Auth & User Service

## 1. Overview
Authentication microservice handling JWT tokens and user profiles.

## 2. API Endpoints

### 2.1 \`POST /auth/login\` - User Login
Authenticates user with email and password.

| Field | Type | Description |
|---|---|---|
| email | string | Registered email |
| password | string | User password |

\`\`\`json
{
  "email": "admin@example.com",
  "password": "secretPassword"
}
\`\`\`

### 2.2 \`GET /auth/me\` - Get Profile
Returns current user profile.

\`\`\`json
{
  "id": "123",
  "name": "Admin"
}
\`\`\`

### 2.3 \`POST /auth/logout\` - Logout
Invalidates active session.

## 3. Security Considerations
Rate limiting and token expiry.
`;

async function run() {
  console.log("=== Testing Import Service Integration ===");

  // Find an admin user
  const [adminUser] = await db
    .select()
    .from(users)
    .where(eq(users.role, "ADMIN"))
    .limit(1);

  if (!adminUser) {
    console.error("No admin user found in database!");
    process.exit(1);
  }

  const actor: Actor = {
    id: adminUser.id,
    role: "ADMIN",
  };

  console.log(`Using admin actor: ${adminUser.email} (${actor.id})`);

  // 1. Test Analyze
  console.log("\n--- Testing Analyze ---");
  const preview = ImportService.analyze(actor, {
    rawMarkdown: sampleMarkdown,
    filename: "Auth-Service.md",
  });

  console.log("Analyzed Strategy:", preview.strategy);
  console.log("Suggested Folder Title:", preview.suggestedFolderTitle);
  console.log("Catalog Sections:", preview.sections.length);
  console.log("Reference Sections:", preview.referenceSections.length);

  if (preview.sections.length !== 3) {
    throw new Error(`Expected 3 catalog sections, got ${preview.sections.length}`);
  }

  // 2. Test Commit with Auto-Publish
  console.log("\n--- Testing Commit (Auto-Publish = true) ---");
  const allItems = [
    ...preview.sections.map((s) => ({
      title: s.title,
      slug: s.slug,
      type: s.type,
      rawMarkdown: s.rawMarkdown,
      orderIndex: s.orderIndex,
      include: true,
    })),
    ...preview.referenceSections.map((s, idx) => ({
      title: s.title,
      slug: s.slug,
      type: s.type,
      rawMarkdown: s.rawMarkdown,
      orderIndex: preview.sections.length + idx,
      include: true,
    })),
  ];

  const result = await ImportService.commit(actor, {
    sourceFilename: "Auth-Service.md",
    rawMarkdown: sampleMarkdown,
    strategyUsed: preview.strategy,
    createFolder: true,
    folderTitle: preview.suggestedFolderTitle,
    folderSlug: preview.suggestedFolderSlug,
    autoPublish: true,
    items: allItems,
  });

  console.log("\nCommit Result:", result);

  // 3. Verify Database State
  const jobResult = await ImportService.getJob(actor, result.jobId);
  console.log("Job Status in DB:", jobResult.job.status);
  console.log("Job Total Sections:", jobResult.job.totalSections);
  console.log("Job Imported Sections:", jobResult.job.importedSections);
  console.log("Job Items in DB count:", jobResult.items.length);

  // Verify created document status and versions
  const firstDocId = jobResult.items[0].documentId;
  if (firstDocId) {
    const [doc] = await db.select().from(documents).where(eq(documents.id, firstDocId));
    console.log(`First Document Title: "${doc.title}", Status: ${doc.status}, Version: ${doc.currentVersion}`);

    const versions = await db
      .select()
      .from(documentVersions)
      .where(eq(documentVersions.documentId, firstDocId));
    console.log(`Document Versions count: ${versions.length} (Version numbers: ${versions.map((v) => v.versionNumber).join(", ")})`);

    if (doc.status !== "PUBLISHED" || versions.length !== 1) {
      throw new Error("Document was not auto-published properly with Version 1!");
    }
  }

  console.log("\n✅ ALL IMPORT SERVICE INTEGRATION TESTS PASSED!");
  process.exit(0);
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
