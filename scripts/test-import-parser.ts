import { analyzeMarkdown, mdastToTiptap, parseMarkdownToAst } from "../src/lib/import";

const sampleApiDoc = `# Campaign Service Documentation

## 1. System Overview
The Campaign Service manages messaging campaigns, targeting criteria, and scheduling.

### 1.1 Architecture
Built with microservices architecture and Postgres.

## 3. Campaign API Reference

### 3.1. \`GET /campaign/campaign-type\` — Get Campaign Types
Retrieve list of campaign types.

| Parameter | Type | Required | Description |
|---|---|---|---|
| status | string | Optional | Filter by status |

\`\`\`json
{
  "types": ["SMS", "EMAIL", "PUSH"]
}
\`\`\`

### 3.2. \`POST /campaign/create\` — Create Campaign
Create a new campaign with payload.

\`\`\`json
{
  "name": "Summer Promo",
  "budget": 5000
}
\`\`\`

### 3.3. \`GET /campaign/view/:id\` — Get Single Campaign
Fetch details of a single campaign.

## 5. Utilities
Utility functions and helper endpoints.

## 6. Overall System Flow
End-to-end execution flow diagrams and descriptions.
`;

console.log("=== Testing Markdown Import Parser ===");
const { splitResult, preview } = analyzeMarkdown(sampleApiDoc, "Campaign-Service-Documentation.md");

console.log("Strategy:", preview.strategy);
console.log("Folder Title:", preview.suggestedFolderTitle);
console.log("Sections count:", preview.sections.length);
console.log("Reference sections count:", preview.referenceSections.length);

console.log("\nDetected Catalog Sections:");
preview.sections.forEach((s) => {
  console.log(`- [${s.method}] ${s.route} => "${s.title}" (slug: ${s.slug})`);
  console.log(`  Metrics:`, s.contentSummary);
});

console.log("\nDetected Reference Sections:");
preview.referenceSections.forEach((s) => {
  console.log(`- "${s.title}" (slug: ${s.slug})`);
});

// Test mdastToTiptap mapper
const ast = parseMarkdownToAst(sampleApiDoc);
const tiptap = mdastToTiptap(ast);
console.log("\nTiptap root type:", tiptap.type);
console.log("Tiptap top-level node count:", tiptap.content?.length);

const hasTable = tiptap.content?.some((n) => n.type === "table");
const hasCodeBlock = tiptap.content?.some((n) => n.type === "codeBlock");
console.log("Has Table converted:", hasTable);
console.log("Has CodeBlock converted:", hasCodeBlock);

if (preview.sections.length === 3 && hasTable && hasCodeBlock) {
  console.log("\n✅ ALL IMPORT PARSER TESTS PASSED!");
} else {
  console.error("\n❌ TESTS FAILED");
  process.exit(1);
}
