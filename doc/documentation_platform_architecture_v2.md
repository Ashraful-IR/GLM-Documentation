# Documentation Platform — System Architecture & Implementation Specification (v2 — Revised)

> **Revision notes (v1 → v2):** This revision simplifies the RBAC model, removes the redundant component tables, adds cycle protection and fractional ordering to the navigation tree, defines an explicit versioning write-policy, adds soft-delete, tightens the DB layer to 6 core tables instead of 11, and collapses the backend from 4 layers to 3. Every change is called out inline with a **`[CHANGED]`** marker so it's easy to diff against v1.

## 1. Project Overview

Build a local documentation management application using Next.js.

The application allows users to create a hierarchical documentation structure using menus and submenus. Every navigation item can have CRUD operations, and document pages contain rich formatted content written through a Tiptap editor.

The core concept is:

Navigation → Document → Tiptap Content

A user creates a menu/document, enters content into the rich text editor, saves it, and that content becomes the actual content of the corresponding documentation page.

The application must be modular and maintainable. UI components must be independently modifiable. The database schema must stay as simple as the requirements allow — complexity is only justified where the domain genuinely needs it (the navigation tree, content storage), not by default (permissions, component tracking).

---

## 2. Core Requirements

### Navigation

The application must support:

- Create menu
- Update menu
- Delete menu
- Create submenu
- Update submenu
- Delete submenu
- Unlimited nesting levels
- Drag-and-drop reordering
- Move an item under another item
- Rename navigation items
- Hide/show navigation items
- Navigation item ordering
- Expand/collapse tree nodes

Do NOT create separate tables for menu, submenu, sub-submenu, etc.

Use a self-referencing navigation table:

```text
navigation
    id
    parent_id → navigation.id
```

**`[CHANGED]`** A self-referencing tree with no additional structure has two failure modes that must be designed against, not discovered in production:

1. **Cycles.** Nothing stops `parent_id` from pointing at a node's own descendant, which creates an infinite loop the moment the tree is walked. Prevention must happen at move-time (see §11).
2. **Slow subtree queries.** "Fetch all descendants of X" or "is X visible given its ancestors' visibility" requires a recursive CTE on every request unless the tree exposes a cheap descendant check. See §11 for the `path` column that solves this.

---

## 3. Documentation Pages

A navigation item of type `DOCUMENT` points to a document.

Relationship:

```text
Navigation
    |
    | document_id
    ↓
Document
    |
    ↓
Tiptap JSON Content
```

The navigation item determines where the document appears in the sidebar.

The document contains the actual page content.

When the user views a document, its stored content is rendered as the page.

---

## 4. Editor Requirements

Use Tiptap as the rich text editor.

The editor should support, where practical:

- Paragraphs, H1–H6 headings
- Bold, italic, underline, strike, inline code, code blocks, syntax highlighting
- Bullet lists, ordered lists, nested lists, blockquotes, horizontal rules
- Links, images, tables (rows/columns), text alignment, text color/highlighting
- Undo/redo, copy/paste, keyboard shortcuts
- Bubble menu, floating menu, slash commands, drag/drop blocks where supported
- Custom callouts, tabs, accordion, API documentation blocks, custom reusable blocks/components

**`[CHANGED]`** Custom blocks (callout, tabs, accordion, API block) are Tiptap **node extensions**. They are represented as typed nodes inside the stored Tiptap JSON — they are not separate relational entities and do not need their own database tables (see §14, which replaces the old Component System section).

The toolbar and editor extensions must be modular. Do not put all editor functionality into one giant component. Prefer a **contextual bubble menu + slash command** over one large fixed toolbar — this keeps the editor visually minimal (see §17).

---

## 5. Tiptap Content Storage

Store the editor content as structured Tiptap JSON in PostgreSQL.

Use:

```text
documents.content JSONB
```

Do not make raw HTML the primary storage format.

Example:

```json
{
  "type": "doc",
  "content": [
    { "type": "heading", "attrs": { "level": 1 }, "content": [{ "type": "text", "text": "System Architecture" }] },
    { "type": "paragraph", "content": [{ "type": "text", "text": "This system uses Next.js and PostgreSQL." }] }
  ]
}
```

---

## 6. Edit Mode vs View Mode

The application must have two document states/views.

### Edit Mode

```text
Navigation → Document → Tiptap Editor → Editable Content
```

### View Mode

```text
Navigation → Document → Stored Tiptap JSON → Tiptap Renderer → Rendered Documentation Page
```

The normal documentation viewer must NOT display the editing toolbar. The same stored content must be usable by both the editor and viewer. **`[CHANGED]`** Keep identical content-column width and typography between the two modes so switching doesn't cause a layout shift.

---

## 7. DOCX Support

The application should support DOCX import/export around the Tiptap document model.

```text
Import:  DOCX → DOCX Parser/Converter → Tiptap JSON → Tiptap Editor
Export:  Tiptap JSON → DOCX Converter → .docx
```

DOCX functionality must be isolated inside:

```text
src/lib/docx/
```

Do not make the core document model dependent on DOCX internals. If a selected DOCX library has limitations, preserve unsupported content gracefully rather than corrupting the document.

---

## 8. Technology Stack

Next.js · TypeScript · App Router · React · Tailwind CSS · shadcn/ui · Tiptap · PostgreSQL · Drizzle ORM · Zod · Zustand · React Hook Form · dnd-kit · localStorage

Do not introduce Redis, cloud storage, or unnecessary external infrastructure. The application will initially run locally.

**`[CHANGED]`** Add the PostgreSQL `ltree` extension (built-in, no new infrastructure — it ships with core Postgres) for efficient navigation subtree queries. See §11.

---

## 9. Local Deployment

```text
Browser → Next.js (http://localhost:3000) → PostgreSQL (local instance)
```

The application must be runnable locally without requiring AWS, Azure, Redis, Kubernetes, or other cloud infrastructure.

---

## 10. PostgreSQL Structure

Database: `documentation_db`
Schema: `documentation`

**`[CHANGED]`** Reduced from 11 tables to 6. Removed: `roles`, `permissions`, `user_roles` (replaced by a single `role` enum column on `users` — see §26), `components`, `document_components` (replaced by the in-code component registry — see §14).

```text
documentation.users
documentation.navigation
documentation.documents
documentation.document_versions
documentation.media
documentation.audit_logs
```

Extension required:

```sql
CREATE EXTENSION IF NOT EXISTS ltree;
```

---

## 11. Navigation Table

```sql
CREATE TYPE nav_type AS ENUM ('FOLDER', 'DOCUMENT', 'LINK');

CREATE TABLE documentation.navigation (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id    UUID REFERENCES documentation.navigation(id) ON DELETE CASCADE,
  path         LTREE NOT NULL,               -- [CHANGED] materialized path, mirrors parent_id
  type         nav_type NOT NULL,
  title        TEXT NOT NULL,
  slug         TEXT NOT NULL,
  document_id  UUID REFERENCES documentation.documents(id),
  link_url     TEXT,                          -- populated only when type = LINK
  icon         TEXT,
  description  TEXT,
  sort_key     TEXT NOT NULL,                 -- [CHANGED] fractional/lexicographic rank, not an integer
  is_visible   BOOLEAN NOT NULL DEFAULT true,
  deleted_at   TIMESTAMPTZ,                   -- [CHANGED] soft delete
  created_by   UUID REFERENCES documentation.users(id),
  updated_by   UUID REFERENCES documentation.users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT slug_unique_per_parent UNIQUE (parent_id, slug)
);

CREATE INDEX nav_parent_idx  ON documentation.navigation (parent_id) WHERE deleted_at IS NULL;
CREATE INDEX nav_path_idx    ON documentation.navigation USING GIST (path);
CREATE INDEX nav_document_idx ON documentation.navigation (document_id);
```

A `FOLDER` is organizational only. A `DOCUMENT` points to a documentation page. A `LINK` points to an external/internal URL.

### `[CHANGED]` Why `path` and `sort_key` were added

- **`path` (ltree):** kept in sync with `parent_id` on every insert/move (`path = parent.path || id::text`). This turns "fetch all descendants of X" into `WHERE path <@ 'root.arch'` (fast, indexed) instead of a recursive CTE, and turns cycle detection into `WHERE new_parent.path <@ old_node.path` (also fast, indexed). Both are the two operations the tree needs constantly (rendering, move validation).
- **`sort_key` (fractional ordering, not an integer):** with a plain integer `sort_order`, inserting or dragging an item between two siblings requires shifting every subsequent sibling's number. A lexicographic rank (`"a0"`, `"am"`, `"az"`, …) lets you compute a new key strictly between two existing ones and update exactly one row. Standard technique used by Notion, Linear, and Figma for reorderable lists.

### Move operation — must be one transaction

```text
BEGIN;
  SELECT id, path FROM navigation WHERE id = :dragged_id FOR UPDATE;
  -- reject if :new_parent_path <@ dragged.path  (would create a cycle)
  UPDATE navigation SET parent_id = :new_parent_id, path = :new_path, sort_key = :new_sort_key
    WHERE id = :dragged_id;
  -- recompute path for every descendant of :dragged_id (ltree subpath replace)
COMMIT;
```

Locking the row (`FOR UPDATE`) and validating the cycle inside the same transaction as the update prevents two concurrent drag operations from corrupting the tree.

---

## 12. Documents Table

```sql
CREATE TYPE document_status AS ENUM ('DRAFT', 'PUBLISHED');

CREATE TABLE documentation.documents (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  content          JSONB NOT NULL DEFAULT '{"type":"doc","content":[]}',
  content_text     TEXT,                      -- [CHANGED] plain-text mirror of content, for full-text search
  status           document_status NOT NULL DEFAULT 'DRAFT',
  current_version  INT NOT NULL DEFAULT 1,
  created_by       UUID REFERENCES documentation.users(id),
  updated_by       UUID REFERENCES documentation.users(id),
  published_by     UUID REFERENCES documentation.users(id),
  published_at     TIMESTAMPTZ,
  deleted_at       TIMESTAMPTZ,                -- [CHANGED] soft delete
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX documents_search_idx ON documentation.documents
  USING GIN (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(content_text,'')));
```

`content_text` is regenerated by the service layer whenever `content` is saved (walk the Tiptap JSON, extract `text` nodes). Keeping it as a plain column the service writes to — rather than a `GENERATED` column with a custom SQL function — keeps the extraction logic in TypeScript where it's easier to test and evolve alongside the Tiptap schema.

For MVP, `DRAFT` and `PUBLISHED` are sufficient; a full `REVIEW` workflow can be added as a third enum value later without a schema migration beyond the enum.

---

## 13. Document Versions

```sql
CREATE TABLE documentation.document_versions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID NOT NULL REFERENCES documentation.documents(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  title          TEXT NOT NULL,
  content        JSONB NOT NULL,
  change_summary TEXT,
  created_by     UUID REFERENCES documentation.users(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE (document_id, version_number)
);
```

### `[CHANGED]` Explicit version-write policy (this was undefined in v1)

Autosave and versioning must not be the same event, or the versions table grows unbounded and "compare versions" becomes meaningless (every diff is three words apart). Policy:

| Event | Effect |
|---|---|
| Autosave debounce (every 1–2s of typing pause) | Updates `documents.content` directly. **No version row.** |
| User clicks **Publish** | Writes a new `document_versions` row, sets `documents.status = PUBLISHED`, `published_at`, `published_by`. |
| User clicks **Save version** (manual checkpoint) | Writes a new `document_versions` row without changing status. |
| Long idle-then-resume editing session (optional, later) | May snapshot a version automatically — not required for MVP. |

The user should eventually be able to: view version history, compare versions, restore a previous version (restoring copies a version's `content` back into `documents.content` and, itself, creates a new version row so the restore is also undoable).

---

## 14. Component System (replaces the old DB-backed component tables)

**`[CHANGED]`** v1 proposed `documentation.components` and `documentation.document_components` tables to track custom blocks relationally. This is redundant: a block's data already lives inside `documents.content` as a typed Tiptap node (e.g. `{"type": "callout", "attrs": {...}}`). Tracking it a second time in relational tables means keeping two representations in sync for no benefit at MVP scope.

Instead, the component system is purely a code-level registry:

```text
Component Registry → Component Resolver → React Component
```

```typescript
const componentRegistry = {
  callout: CalloutComponent,
  api: ApiComponent,
  tabs: TabsComponent,
  accordion: AccordionComponent,
  code: CodeBlockComponent,
};
```

Recommended editor structure:

```text
components/editor/
├── DocumentEditor.tsx
├── EditorToolbar.tsx
├── BubbleMenu.tsx
├── FloatingMenu.tsx
├── SlashCommand.tsx
├── extensions/
│   ├── CalloutExtension.ts
│   ├── ApiBlockExtension.ts
│   ├── CustomComponentExtension.ts
│   └── ...
└── blocks/
    ├── Callout.tsx
    ├── CodeBlock.tsx
    ├── ApiBlock.tsx
    ├── ImageBlock.tsx
    ├── Tabs.tsx
    └── Accordion.tsx
```

Each component must be independently modifiable. Avoid tightly coupling business logic to the editor. Adding or modifying a component should not require rewriting the entire editor.

> If a future requirement needs a **reusable snippet library** (save a block once, insert it into many documents, edit all instances at once), that is a genuinely different feature from the extension registry above and would justify a `snippets` table then — don't build it speculatively now.

---

## 15. shadcn/ui Architecture

Use shadcn/ui as the base UI primitive layer, under `src/components/ui/` (button, dialog, dropdown-menu, input, textarea, select, popover, command, tabs, tooltip, sheet, alert-dialog).

Application-specific components must be built above this layer:

```text
shadcn Button → SaveDocumentButton → DocumentEditor
```

Do not place application business logic directly inside generic shadcn primitives.

---

## 16. Design Direction — smooth, minimal, beautiful

**`[CHANGED]`** Added concrete direction since "minimal" was previously just an adjective in the brief.

- **One accent color, everything else neutral grayscale.** shadcn's `zinc`/`neutral` base is a good default; reserve color for state (unsaved/error/success) and the single accent — not decoration.
- **Sidebar tree:** virtualize for large trees; animate expand/collapse with a simple height transition (~150ms) rather than a spring animation library — snappy reads as "smooth" more reliably than bouncy.
- **Editor toolbar:** no large fixed toolbar. Bubble menu on text selection + `/` slash command for insertion covers the vast majority of actions with zero permanent chrome — this is the single biggest lever for making the editor feel minimal.
- **Save state indicator:** one small text label near the title (`Saved`, `Saving…`, `Unsaved changes`, `Save failed`) — not a toast. Toasts firing every autosave cycle get noisy fast.
- **Edit/view mode parity:** identical content-column width and typography in both modes so toggling between them causes no layout shift.
- **Whitespace over borders:** prefer spacing and subtle background-color differences over visible dividing lines to separate sidebar / content / editor regions.

## 17. Main UI Layout

```text
┌───────────────────────────────────────────────────────────────┐
│ Logo │ Search documentation...                 User │ Settings │
├───────────────────┬───────────────────────────────────────────┤
│ Documentation     │                                           │
│                   │ Architecture                              │
│ ▼ Overview        │ ───────────────────────────────────────   │
│                   │                                           │
│ ▼ Architecture    │ Our system follows a layered             │
│   ├ Frontend      │ architecture...                           │
│   │ ├ Next.js     │                                           │
│   │ └ React       │ ## Frontend                               │
│   ├ Backend       │                                           │
│   └ Database      │ The frontend is built with Next.js.      │
│                   │                                           │
│ ▼ Deployment      │ ## Backend                                │
│                   │                                           │
│ + Add             │ Backend services...                       │
└───────────────────┴───────────────────────────────────────────┘
```

In edit mode:

```text
┌───────────────────┬───────────────────────────────────────────┐
│ Navigation        │ Tiptap Editor                             │
│ Architecture      │ [B] [I] [H1] [H2] [Code] [Image] [+]     │  <- contextual bubble menu, not fixed
│ ├ Frontend        │ ───────────────────────────────────────   │
│ ├ Backend         │ # Architecture                            │
│ └ Database        │                                           │
│                   │ Documentation content...                   │
│                   │ /                                         │
│                   │ Saved ✓                                   │
└───────────────────┴───────────────────────────────────────────┘
```

---

## 18. Navigation CRUD UX

Each navigation node has an action menu (`⋮`).

For a folder node: Add child, Rename, Edit, Move, Duplicate, Hide, Delete.
For a document node: Open, Edit, Add child, Rename, Move, Duplicate, Publish, Delete.

Deletion uses a confirmation dialog. For folders containing children, clearly communicate whether deletion will (1) delete descendants, or (2) is blocked until children are moved. **`[CHANGED]`** Because navigation and documents are soft-deleted (`deleted_at`), "delete" is recoverable by default — prefer soft delete + a "restore from trash" affordance over prompting for hard, irreversible deletes. Reserve a genuinely irreversible hard-delete for an explicit "empty trash" action.

---

## 19. Drag and Drop

Use `dnd-kit`. Support reordering siblings, moving a node into/out of a folder, changing parent, preserving order.

```text
Before:                          After moving Database under Backend:
Architecture                     Architecture
├── Frontend                     ├── Frontend
├── Backend                      └── Backend
└── Database                         └── Database
```

**`[CHANGED]`** Update `parent_id`, `path`, and `sort_key` atomically on the server inside a single transaction, with row locking and cycle validation (see §11's move-operation transaction). This is where v1 was underspecified — "atomically" was stated but the actual cycle-safety and locking requirements weren't.

---

## 20. LocalStorage Strategy

Use localStorage only for client-side caching and temporary state:

```text
documentation:navigation
documentation:recent-documents
documentation:editor:draft:<document-id>
documentation:editor:last-position:<document-id>
documentation:ui:sidebar-state
documentation:ui:theme
```

PostgreSQL remains the source of truth. Do not store the complete authoritative application database in localStorage.

---

## 21. Editor Autosave

```text
User types → Tiptap JSON changes → Debounce 1–2s → Save draft to localStorage → Persist to API → PostgreSQL
```

Display save status: `Saving...` / `Saved ✓` / `Unsaved changes` / `Save failed`.

### `[CHANGED]` Draft-recovery conflict resolution (undefined in v1)

```text
Open document → Check localStorage → Unsaved draft exists →
  Compare draft's captured server `updated_at` against the document's CURRENT `updated_at`
    → unchanged: "Restore unsaved changes?"
    → changed (edited elsewhere since draft was captured): warn explicitly that the
      server version has moved on, and let the user choose which to keep —
      do not silently overwrite either version.
```

---

## 22. API Architecture

Use Next.js Route Handlers.

```text
app/api/
├── auth/{login,logout,me}/
├── navigation/route.ts, [id]/route.ts
├── documents/route.ts, [id]/{route.ts, versions/, publish/, restore/}
├── media/
├── search/
└── users/
```

---

## 23. Application Layer

**`[CHANGED]`** Collapsed from 4 layers to 3. A dedicated Repository layer between Service and Drizzle is pure indirection at this scale — Drizzle queries live directly in the service file. This still satisfies "no direct database calls from UI components" (Rule 12); it just avoids a pass-through file for every table that adds no behavior.

```text
Route Handler → Service (validation, permission check, business logic, Drizzle queries) → PostgreSQL
```

Example:

```text
PATCH /api/documents/:id
        ↓
DocumentService
        ↓
- validate data (Zod)
- check permission (role check)
- update document
- create version if the write matches the version policy in §13
- write audit log
        ↓
PostgreSQL (via Drizzle, called directly from the service)
```

If a genuine need for swappable persistence or repository-level unit testing shows up later, extracting a repository layer at that point is a mechanical refactor — it's not worth paying for upfront.

---

## 24. Project Structure

```text
src/
├── app/
│   ├── (auth)/{login,register}/
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── documentation/{page.tsx, [slug]/}
│   │   ├── editor/[id]/
│   │   ├── media/
│   │   ├── users/
│   │   └── settings/
│   └── api/{auth,navigation,documents,media,search,users}/
│
├── components/{ui, navigation, editor, documents, documentation}/
│
├── services/                       # [CHANGED] repository logic merged in here
│   ├── navigation.service.ts
│   ├── document.service.ts
│   ├── version.service.ts
│   ├── search.service.ts
│   └── user.service.ts
│
├── db/
│   ├── index.ts
│   ├── schema/{navigation.ts, documents.ts, versions.ts, users.ts, media.ts, audit.ts}
│   └── migrations/
│
├── lib/{auth/, editor/, docx/, storage/local-storage.ts, utils/}
├── hooks/{useNavigation.ts, useDocument.ts, useEditor.ts, useLocalStorage.ts}
├── schemas/{navigation.schema.ts, document.schema.ts, user.schema.ts}
├── types/
└── config/
```

---

## 25. Search

MVP search uses PostgreSQL full-text search (the GIN index defined in §12) across document title, content, navigation title, slug, and description. Do not introduce Elasticsearch/OpenSearch for the initial local version.

---

## 26. Permissions — simplified

**`[CHANGED]`** v1 specified full dynamic RBAC (`roles`, `permissions`, `user_roles` join tables) for three fixed roles. That's a permission *engine* for a permission *list* — replaced with a single enum column and a code-level check.

```sql
CREATE TYPE user_role AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');
-- users.role user_role NOT NULL DEFAULT 'VIEWER'
```

```typescript
// lib/auth/permissions.ts
const permissions: Record<UserRole, string[]> = {
  ADMIN:  ['documentation.*', 'users.manage'],
  EDITOR: ['documentation.read', 'documentation.create', 'documentation.update', 'documentation.publish', 'navigation.create', 'navigation.update'],
  VIEWER: ['documentation.read'],
};
```

Do not rely only on frontend permission checks. Validate permissions on the server/API, inside each service method — not the route handler, so the check can't be bypassed by calling the service from a different entry point.

> If custom, per-organization roles become a real requirement later, that's the point to introduce a `permissions`/`role_permissions` table — not before.

---

## 27. Audit Logs

```text
documentation.audit_logs
  id, user_id, action, entity_type, entity_id, metadata, created_at
```

Track: `DOCUMENT_CREATED`, `DOCUMENT_UPDATED`, `DOCUMENT_DELETED`, `DOCUMENT_PUBLISHED`, `DOCUMENT_RESTORED`, `NAVIGATION_CREATED`, `NAVIGATION_UPDATED`, `NAVIGATION_DELETED`, `NAVIGATION_MOVED`.

---

## 28. Media

For the local MVP, media is stored on disk:

```text
/uploads
    /images
    /documents
    /attachments
```

```text
documentation.media
  id, filename, original_name, mime_type, size, path, uploaded_by, created_at
```

Do not store large binary files directly in PostgreSQL unless there is a strong reason. Validate uploaded files, restrict upload size, and prevent path traversal on the `path` field.

---

## 29. Document Lifecycle

```text
DRAFT → PUBLISHED
```

(`REVIEW` and `ARCHIVED` can be added to the `document_status` enum later without a structural migration.) The user can continue editing a published document; edits update `documents.content` directly and only produce a new version on the next explicit publish/checkpoint (§13).

---

## 30. Error Handling

Consistent API responses:

```json
// success
{ "success": true, "data": {} }

// error
{ "success": false, "error": { "code": "DOCUMENT_NOT_FOUND", "message": "Document not found" } }
```

Use Zod for request validation. Do not expose raw database errors to the frontend.

---

## 31. Security Requirements

- Validate every API input (Zod)
- Server-side authorization on every service method, not just the route
- Sanitize/render rich content safely
- Validate uploaded files, restrict upload size, prevent path traversal
- Do not trust localStorage values; do not use it for auth secrets
- Parameterized queries through Drizzle
- Protect destructive operations with confirmation, and prefer soft delete (§18) so destructive mistakes are recoverable

---

## 32. Implementation Order

### Phase 1 — Foundation
Next.js, TypeScript, Tailwind, shadcn/ui, PostgreSQL + `ltree` extension, Drizzle, `documentation` schema, env config.

### Phase 2 — Navigation
Table + `path`/`sort_key` design, tree UI, create/rename/delete, expand/collapse, drag/drop with transactional move + cycle check.

### Phase 3 — Documents
Table, navigation↔document relationship, create/edit/delete, viewer.

### Phase 4 — Tiptap
Setup, bubble/slash-command UI (no fixed toolbar), formatting, lists, code blocks, images, tables, links, custom block extensions via the registry (§14).

### Phase 5 — Persistence
JSON storage, autosave (content only, no version row), localStorage draft, conflict-aware draft recovery (§21), save-state indicator.

### Phase 6 — Versioning
Version rows created per the explicit policy in §13; history view, compare, restore.

### Phase 7 — DOCX
Import/export isolated in `src/lib/docx/`, graceful degradation for unsupported formatting.

### Phase 8 — Search
Postgres full-text search + GIN index, search UI, result highlighting.

### Phase 9 — Permissions
`role` enum on users, code-level permission checks enforced server-side in every service method.

### Phase 10 — Polish
Responsive UI, loading/error/empty states, confirmation dialogs, keyboard shortcuts, accessibility, performance.

---

## 33. Important Architectural Rules

1. Navigation and document content are separate entities (`Navigation ≠ Document`).
2. Self-referencing `parent_id` for unlimited nesting, backed by a `path` (ltree) column for cheap subtree/cycle queries. **`[CHANGED]`**
3. Tiptap JSON is the canonical document content format.
4. PostgreSQL is the source of truth.
5. localStorage is only client-side cache/draft state.
6. Do not use Redis.
7. Do not introduce cloud infrastructure.
8. Use shadcn/ui as the UI primitive layer.
9. Editor functionality must be modular.
10. Custom blocks/components must be independently modifiable, and live as Tiptap node extensions, not extra DB tables. **`[CHANGED]`**
11. Business logic must live in services, not React components.
12. Database access must go through the service layer — a separate repository layer is optional, not required. **`[CHANGED]`**
13. Validate all API input with Zod.
14. Do not put the entire application state into localStorage.
15. Do not create separate tables for different menu levels.
16. **`[NEW]`** Versions are created only per the explicit policy in §13 — never on every autosave.
17. **`[NEW]`** Destructive operations on navigation/documents default to soft delete (`deleted_at`); hard delete is a separate, rarer action.
18. **`[NEW]`** Sibling ordering uses a fractional/lexicographic `sort_key`, not a plain integer, to avoid cascading updates on reorder.

---

## 34. Expected User Flow

### Create documentation
User → Click "+ Add" → Create Document → Enter title → Select parent → Tiptap editor opens → Enter content → Save → Document appears in navigation.

### View documentation
User → Click navigation item → Fetch document → Load Tiptap JSON → Render page.

### Edit documentation
User → Click Edit → Tiptap loads existing JSON → User modifies content → Autosave (content only) → PostgreSQL updated → Version created only if this save matches the versioning policy (publish or manual checkpoint).

---

## 35. Definition of Done

- [ ] Next.js application runs locally
- [ ] PostgreSQL connection works, `ltree` extension enabled
- [ ] `documentation` schema exists with the 6-table core model
- [ ] Navigation CRUD works, including soft delete/restore
- [ ] Unlimited nested navigation works, with cycle-safe moves
- [ ] Navigation drag/drop works using fractional `sort_key`
- [ ] Document CRUD works
- [ ] A navigation document opens its corresponding page
- [ ] Tiptap editor works with bubble menu + slash commands (no fixed toolbar)
- [ ] Rich text formatting works
- [ ] Tiptap JSON is persisted in PostgreSQL
- [ ] Document viewer renders saved content with edit/view mode layout parity
- [ ] localStorage draft caching works, with conflict-aware recovery
- [ ] Autosave works and does not create version rows
- [ ] Versioning follows the explicit publish/checkpoint policy
- [ ] shadcn components are used
- [ ] Components are modular and independently modifiable
- [ ] DOCX import/export is implemented or cleanly isolated behind an adapter
- [ ] Basic search works (Postgres full-text)
- [ ] Basic authentication/authorization works via the `role` enum
- [ ] API validation works
- [ ] Error states are handled
- [ ] Application runs entirely on the local machine

---

## 36. Target Architecture

```text
                         DOCUMENTATION PLATFORM
                                  |
             +--------------------+--------------------+
             |                    |                    |
             v                    v                    v
      NAVIGATION ENGINE     DOCUMENT ENGINE      COMPONENT REGISTRY
             |                    |                    |
   Self-referencing tree      Tiptap JSON          Code-level
   + ltree path (cycle-      Editor / Viewer       registry/resolver
     safe subtree queries)   Autosave              (no DB tables)
   Fractional sort_key       Explicit version
   Drag/drop                 write-policy
             |                    |                    |
             +--------------------+--------------------+
                                  |
                                  v
                         APPLICATION SERVICES
                        (validation + auth + DB access
                         in one service layer per domain)
                                  |
                    +-------------+-------------+
                    |             |             |
                    v             v             v
                 Auth          Search        Media
              (role enum)  (Postgres FTS)  (local disk)
                    |             |             |
                    +-------------+-------------+
                                  |
                                  v
                            DRIZZLE ORM
                                  |
                                  v
                 PostgreSQL: documentation (6 tables)
                                  |
                                  v
                         Local deployment


Browser-side cache:

Tiptap Editor
      |
      +------> localStorage
      |          +-- Draft (with server updated_at snapshot for conflict check)
      |          +-- Navigation cache
      |          +-- Recent documents
      |          +-- UI preferences
      |
      +------> Next.js API
                   |
                   v
              PostgreSQL
```

---

## 37. Coding Style

- TypeScript strict mode
- Small, focused, single-responsibility components
- Reusable hooks and services
- Explicit types, no unnecessary `any`
- Zod validation on every API boundary
- No duplicated business logic
- No direct database calls from UI components
- No large monolithic components
- Clear naming conventions, consistent error handling
- Keep editor extensions isolated
- Keep DOCX functionality isolated
- Keep localStorage access behind a utility/service
- Keep database schema organized under the `documentation` namespace, and keep it as small as the requirements genuinely need — add tables when a real feature needs them, not preemptively

The resulting application should be a maintainable local-first documentation platform rather than a simple CRUD page builder — and its schema should be no bigger than the problem it's solving.
