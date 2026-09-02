import { analyzeMarkdown, parseMarkdownToAst, mdastToTiptap } from "../src/lib/import";

const markdownWithSubheadings = `# Campaign API Documentation

## 1. System Overview
The Campaign Service manages messaging campaigns, targeting criteria, and scheduling.

### 1.1 Architecture
Built with microservices architecture and Postgres.

## 3. Campaign API Reference

### 3.1. \`GET /campaign/campaign-type\` — Get Campaign Types
Retrieve list of campaign types.

#### Request Parameters
| Parameter | Type | Required | Description |
|---|---|---|---|
| status | string | Optional | Filter by status |

#### Response Schema
\`\`\`json
{
  "types": ["SMS", "EMAIL", "PUSH"]
}
\`\`\`

##### Additional Notes
- Requires admin or manager role.
- Cached for 60 seconds.

### 3.2. \`POST /campaign/create\` — Create Campaign
Create a new campaign with payload.

#### Request Payload
\`\`\`json
{
  "name": "Summer Promo",
  "budget": 5000
}
\`\`\`
`;

console.log("=== Testing Markdown Import with Sub-headings ===");
const { preview } = analyzeMarkdown(markdownWithSubheadings, "Campaign-API-Doc.md");

console.log("\nDetected Catalog Sections:");
preview.sections.forEach((s) => {
  console.log(`\n- [${s.method}] ${s.route} => "${s.title}"`);
  console.log(`  Metrics:`, s.contentSummary);
  console.log(`  Raw Markdown:\n${s.rawMarkdown}`);
  const ast = parseMarkdownToAst(s.rawMarkdown);
  const tiptap = mdastToTiptap(ast);
  console.log(`  Tiptap Top-level Nodes: ${tiptap.content?.length}`);
  console.log(`  Node Types:`, tiptap.content?.map(n => n.type));
});
