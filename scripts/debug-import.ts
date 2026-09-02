import { analyzeMarkdown, parseMarkdownToAst, mdastToTiptap } from "../src/lib/import";

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
`;

const { preview } = analyzeMarkdown(sampleApiDoc, "Campaign-Service-Documentation.md");

console.log("=== Preview Sections ===");
for (const s of preview.sections) {
  console.log(`\n--- Section: ${s.title} ---`);
  console.log("rawMarkdown length:", s.rawMarkdown?.length);
  console.log("rawMarkdown content:\n" + s.rawMarkdown);
  const ast = parseMarkdownToAst(s.rawMarkdown);
  const tiptap = mdastToTiptap(ast);
  console.log("Tiptap JSON node count:", tiptap.content?.length);
  console.log("Tiptap JSON:", JSON.stringify(tiptap, null, 2));
}
