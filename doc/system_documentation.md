# System Documentation & Architecture Manual

Comprehensive architectural specification and technical manual for the **Documentation Platform** — a local-first, hierarchical documentation management engine built with Next.js 16, PostgreSQL (with `ltree`), Drizzle ORM, and Tiptap v3.

---

## Table of Contents

1. [Executive Summary & Core Philosophy](#1-executive-summary--core-philosophy)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Database Schema & Data Model](#4-database-schema--data-model)
   - [Schema Namespace](#schema-namespace)
   - [Core Tables & Entity Relationships](#core-tables--entity-relationships)
   - [PostgreSQL Extensions & Specialized Indexes](#postgresql-extensions--specialized-indexes)
5. [Navigation Tree Subsystem](#5-navigation-tree-subsystem)
   - [Materialized Paths with `ltree`](#materialized-paths-with-ltree)
   - [Fractional Indexing & Lexicographical Sorting](#fractional-indexing--lexicographical-sorting)
   - [Cycle Detection & Subtree Relocation](#cycle-detection--subtree-relocation)
   - [Drag & Drop Tree Reordering Model](#drag--drop-tree-reordering-model)
   - [Active Document & Deletion Fallback](#active-document--deletion-fallback)
6. [Document Management & Versioning System](#6-document-management--versioning-system)
   - [Dual-State Architecture (Draft vs. Published)](#dual-state-architecture-draft-vs-published)
   - [Tiptap JSON Canonical Format](#tiptap-json-canonical-format)
   - [Autosave & Local Draft Recovery](#autosave--local-draft-recovery)
   - [Version Checkpoints & Safe Restoration](#version-checkpoints--safe-restoration)
   - [Soft Delete & Trash Lifecycle](#soft-delete--trash-lifecycle)
7. [Rich Text Editor Subsystem](#7-rich-text-editor-subsystem)
   - [Editor Architecture & Extensions](#editor-architecture--extensions)
   - [Contextual UX: Bubble Menu & Slash Commands](#contextual-ux-bubble-menu--slash-commands)
   - [Custom Block Nodes](#custom-block-nodes)
   - [View/Edit Typography & Layout Parity](#viewedit-typography--layout-parity)
8. [Authentication, Authorization & Security](#8-authentication-authorization--security)
   - [Stateless HMAC Session System](#stateless-hmac-session-system)
   - [Role-Based Access Control (RBAC) Matrix](#role-based-access-control-rbac-matrix)
   - [Service-Layer Security Enforcement](#service-layer-security-enforcement)
9. [Full-Text Search Engine](#9-full-text-search-engine)
   - [PostgreSQL Full-Text Search (`tsvector` & GIN)](#postgresql-full-text-search-tsvector--gin)
   - [Global Command Palette (`SearchCommand`)](#global-command-palette-searchcommand)
10. [Media Asset Management](#10-media-asset-management)
11. [Audit Logging Subsystem](#11-audit-logging-subsystem)
12. [Project & Directory Structure](#12-project--directory-structure)
13. [API Route Reference](#13-api-route-reference)
14. [Operations, Setup & Testing Runbook](#14-operations-setup--testing-runbook)

---

## 1. Executive Summary & Core Philosophy

The **Documentation Platform** is a local-first, enterprise-grade documentation system designed for teams and developers to organize, author, and publish structured documentation.

```text
┌────────────────────────────────────────────────────────┐
│                        CORE FLOW                       │
│                                                        │
│   Navigation Tree  ───►  Document Record  ───►  Tiptap  │
│   (ltree + sort)         (Draft / Pub)        Content  │
└────────────────────────────────────────────────────────┘
```

### Core Design Principles:
1. **Local-First & Zero Cloud Lock-in**: Fully functional within a local environment. PostgreSQL runs isolated with zero external cloud dependencies.
2. **Canonical Structural Hierarchy**: Navigation items determine the document tree and URL slug routing. The hierarchy is decoupled from raw file systems, backing unlimited nesting depths.
3. **Data Integrity & Consistency**: Tree mutations (moves, renames, reparenting) are executed in strictly atomic database transactions with cycle prevention and automatic subtree path rewriting.
4. **Draft-Safety & Non-Destructive Publishing**: Authors edit working drafts with continuous background autosave and local backup. Public consumers view verified, published revisions.
5. **Clean 3-Tier Layering**: `Route Handlers -> Domain Services -> PostgreSQL / Drizzle`. Business logic, authorization, and audit trail generation are strictly encapsulated in domain services.

---

## 2. High-Level Architecture

The platform follows a modular, three-tier architecture:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                             PRESENTATION LAYER                           │
│                                                                          │
│  ┌────────────────────────┐  ┌─────────────────────┐  ┌────────────────┐ │
│  │ AppShell & Navigation  │  │ Tiptap v3 Editor    │  │ Document View  │ │
│  │ (Sidebar, Dnd-Kit Tree)│  │ (Bubble/Slash UI)   │  │ (OnThisPage,   │ │
│  │                        │  │                     │  │  VersionModal) │ │
│  └────────────────────────┘  └─────────────────────┘  └────────────────┘ │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ HTTP / Server Actions
┌────────────────────────────────────▼─────────────────────────────────────┐
│                             API ROUTE HANDLERS                           │
│  /api/auth  •  /api/navigation  •  /api/documents  •  /api/search       │
│  /api/media •  /api/users       •  /api/audit                           │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ Session Verification + Zod Schemas
┌────────────────────────────────────▼─────────────────────────────────────┐
│                            DOMAIN SERVICE LAYER                          │
│                                                                          │
│  ┌───────────────────────┐ ┌──────────────────────┐ ┌──────────────────┐ │
│  │ NavigationService     │ │ DocumentService      │ │ SearchService    │ │
│  │ (Tree, ltree, sort)   │ │ (Drafts, Versioning) │ │ (tsvector / GIN) │ │
│  ├───────────────────────┤ ├──────────────────────┤ ├──────────────────┤ │
│  │ UserService           │ │ MediaService         │ │ AuditService     │ │
│  │ (RBAC, Auth tokens)   │ │ (Uploads, FS Sync)   │ │ (Event Logging)  │ │
│  └───────────────────────┘ └──────────────────────┘ └──────────────────┘ │
└────────────────────────────────────┬─────────────────────────────────────┘
                                     │ Drizzle ORM / SQL Fragments
┌────────────────────────────────────▼─────────────────────────────────────┐
│                           DATABASE & STORAGE                             │
│                                                                          │
│  PostgreSQL Schema: `documentation`                                      │
│  - `navigation` (ltree path + GIST index)                                │
│  - `documents` (JSONB Tiptap AST + GIN search index)                     │
│  - `document_versions` (Historical snapshot checkpoints)                 │
│  - `users` (RBAC accounts)                                               │
│  - `media` (Asset metadata)                                              │
│  - `audit_logs` (System audit records)                                   │
│  - Local Disk: `public/uploads/*`                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Technology Stack

| Layer | Technology | Details |
|---|---|---|
| **Framework** | Next.js 16 (App Router) | Server Components, Route Handlers, Turbopack, React 19 |
| **Language** | TypeScript (Strict) | End-to-end type safety, Zod runtime validation |
| **Styling & UI** | Tailwind CSS v4 + shadcn/ui | Radix UI primitives, `tw-animate-css`, `next-themes` (Dark/Light mode) |
| **Rich Text Editor** | Tiptap v3 + ProseMirror | Bubble Menu, Floating Menu, Slash Command suggestions, Custom Blocks |
| **Code Highlighting**| lowlight + highlight.js | Syntax highlighting in code blocks |
| **Drag & Drop** | `@dnd-kit/core` + `@dnd-kit/sortable` | Accessible, touch-enabled tree reorganization |
| **Database** | PostgreSQL 15+ with `ltree` | Materialized paths, GIN full-text index, partial indexes |
| **ORM** | Drizzle ORM + `postgres.js` | Type-safe SQL builder, custom `ltree` mapping, transactions |
| **Authentication** | Stateless HMAC-SHA256 Cookies | Cryptographic signed cookies, PBKDF2/bcryptjs password hashing |
| **Search** | PostgreSQL Full-Text Search | `to_tsvector('english', ...)`, `websearch_to_tsquery`, GIN index |
| **State Management**| Zustand + React Hooks | Client-side reactive stores, modal triggers, draft recovery |

---

## 4. Database Schema & Data Model

### Schema Namespace
All application tables live inside an isolated PostgreSQL schema named `documentation` to eliminate naming collisions:

```sql
CREATE SCHEMA IF NOT EXISTS documentation;
CREATE EXTENSION IF NOT EXISTS ltree;
```

### Core Tables & Entity Relationships

```
              ┌────────────────────────┐
              │         users          │
              ├────────────────────────┤
              │ id (UUID, PK)          │
              │ email (TEXT, UNIQUE)   │
              │ name (TEXT)            │
              │ role (ENUM)            │
              └───────────┬────────────┘
                          │ 1:N
            ┌─────────────┴─────────────┐
            │                           │
            ▼                           ▼
┌───────────────────────┐   ┌────────────────────────┐
│      navigation       │   │       documents        │
├───────────────────────┤   ├────────────────────────┤
│ id (UUID, PK)         │   │ id (UUID, PK)          │
│ parent_id (UUID, FK)──┼─┐ │ title (TEXT)           │
│ path (LTREE)          │ │ │ content (JSONB)        │
│ type (ENUM)           │ │ │ content_text (TEXT)    │
│ slug (TEXT)           │ │ │ published_title (TEXT) │
│ sort_key (TEXT)       │ │ │ published_content(JSONB│
│ document_id (UUID, FK)├─┼─► status (ENUM)          │
│ is_visible (BOOLEAN)  │ │ │ current_version (INT)  │
│ deleted_at (TIMESTAMP)│ │ │ deleted_at (TIMESTAMP) │
└───────────────────────┘ │ └───────────┬────────────┘
        │                 │             │
        └─────────────────┘             │ 1:N
                                        ▼
                            ┌────────────────────────┐
                            │   document_versions    │
                            ├────────────────────────┤
                            │ id (UUID, PK)          │
                            │ document_id (UUID, FK) │
                            │ version_number (INT)   │
                            │ content (JSONB)        │
                            │ change_summary (TEXT)  │
                            └────────────────────────┘
```

#### 1. `users`
Stores system accounts and role levels (`ADMIN`, `EDITOR`, `VIEWER`).
- **Columns**: `id`, `email`, `name`, `password_hash`, `role`, `avatar_url`, `created_at`, `updated_at`.
- **Indexes**: Unique index on `email`, B-tree on `role`.

#### 2. `navigation`
Self-referencing tree representing the sidebar hierarchy.
- **Columns**: `id`, `parent_id` (FK self-reference with cascade), `path` (`ltree`), `type` (`FOLDER`, `DOCUMENT`, `LINK`), `title`, `slug`, `document_id` (FK `documents.id`), `link_url`, `icon`, `description`, `sort_key`, `is_visible`, `deleted_at`, `created_by`, `updated_by`, timestamps.
- **Indexes**:
  - `GIST` on `path` (high-speed ancestor/descendant queries).
  - Partial index on `parent_id` `WHERE deleted_at IS NULL`.
  - Unique composite index on `(parent_id, slug)` to prevent sibling slug conflicts.
  - B-tree on `document_id`.

#### 3. `documents`
Stores rich text document state.
- **Columns**: `id`, `title`, `content` (`jsonb`), `content_text` (plain-text search mirror), `published_title`, `published_content` (`jsonb`), `status` (`DRAFT`, `PUBLISHED`), `current_version`, `deleted_at`, `created_by`, `updated_by`, `published_by`, `published_at`, timestamps.
- **Indexes**:
  - `GIN` index on `to_tsvector('english', coalesce(title, '') || ' ' || coalesce(content_text, ''))`.

#### 4. `document_versions`
Point-in-time historical checkpoints generated strictly upon explicit publish or manual save.
- **Columns**: `id`, `document_id` (FK `documents.id`), `version_number`, `title`, `content` (`jsonb`), `change_summary`, `created_by`, `created_at`.
- **Indexes**: Unique composite index on `(document_id, version_number)`.

#### 5. `media`
Tracks uploaded files and images.
- **Columns**: `id`, `filename`, `original_name`, `mime_type`, `size`, `path`, `uploaded_by`, `created_at`.
- **Indexes**: B-tree on `uploaded_by`.

#### 6. `audit_logs`
Structured audit trail for every modifying mutation.
- **Columns**: `id`, `user_id`, `action`, `entity_type`, `entity_id`, `metadata` (`jsonb`), `created_at`.
- **Indexes**: B-tree on `(entity_type, entity_id)`, B-tree on `created_at`.

---

## 5. Navigation Tree Subsystem

The navigation tree is one of the most critical subsystems in the platform. It handles arbitrary depth nesting, reordering, cycle prevention, and high-performance querying.

### Materialized Paths with `ltree`

Every navigation item maintains a materialized path column using PostgreSQL `ltree`:
- Root item with UUID `a1b2c3...`: `path = 'a1b2c3'` (hyphens stripped)
- Child item with UUID `d4e5f6...`: `path = 'a1b2c3.d4e5f6'`
- Grandchild with UUID `789abc...`: `path = 'a1b2c3.d4e5f6.789abc'`

#### Advantages:
- **Subtree Retrieval in O(1)**: `SELECT * FROM navigation WHERE path <@ 'a1b2c3'` instantly fetches all descendants at any nesting depth using the `GIST` index.
- **Ancestor Lookup**: `SELECT * FROM navigation WHERE path @> 'a1b2c3.d4e5f6.789abc'` fetches the full breadcrumb trail without recursive CTEs.

### Fractional Indexing & Lexicographical Sorting

Items within the same parent are ordered by a string `sort_key` using a fractional indexing algorithm (`src/lib/tree/fractional-index.ts`):
- Inserting between `"a0"` and `"a1"` produces `"a0V"`.
- Never requires shifting or updating neighbor rows (`O(1)` inserts).
- Automatic rebalancing occurs if key length exceeds safety thresholds.

### Cycle Detection & Subtree Relocation

When an item $S$ (source) is moved under item $T$ (target):
1. **Cycle Prevention**: Check if $T$'s path is a descendant of $S$'s path (`target.path <@ source.path`). If true, reject with `NavigationCycleError`.
2. **Transactional Subtree Path Rewrite**: When moving node $S$ with path $P_{old}$ to new parent with path $P_{parent}$, the new path is $P_{new} = P_{parent} . S_{id}$. All descendants of $S$ have their paths updated in a single SQL operation:
   ```sql
   UPDATE documentation.navigation
   SET path = ${newPath}::ltree || subpath(path, nlevel(${oldPath}::ltree))
   WHERE path <@ ${oldPath}::ltree;
   ```

### Drag & Drop Tree Reordering Model

The UI employs `@dnd-kit` with tree flattening utilities (`src/lib/tree/flatten.ts`):
- Flattens hierarchical structures into a virtual list based on expand/collapse state.
- Computes valid drag indentation levels (projected depth).
- Prevents invalid drops (e.g., dropping a parent inside its own collapsed child).

### Active Document & Deletion Fallback

When a document or navigation item is deleted or moved to trash, `src/lib/tree/fallback.ts` computes the optimal adjacent document to navigate the user to (next sibling $\to$ previous sibling $\to$ parent document $\to$ root doc).

---

## 6. Document Management & Versioning System

### Dual-State Architecture (Draft vs. Published)

To ensure reader stability while editors work on extensive revisions:

```
┌─────────────────────────────────────────────────────────────┐
│                       DOCUMENT RECORD                       │
│                                                             │
│  Working Draft (Autosaved)      Published Version (Reader)  │
│  ┌───────────────────────────┐  ┌────────────────────────┐  │
│  │ title: "API Guide v2"     │  │ published_title:       │  │
│  │ content: {...Tiptap JSON} │  │   "API Guide v1"       │  │
│  │ status: "DRAFT"           │  │ published_content:     │  │
│  │                           │  │   {...Tiptap JSON}     │  │
│  └───────────────────────────┘  └────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

- **Viewer Mode**: Reads `published_content` (or falls back to `content` if never published).
- **Editor Mode**: Reads and modifies `content`.
- **Publish Action**: Copies `title` $\to$ `published_title`, `content` $\to$ `published_content`, marks `status = 'PUBLISHED'`, increments `current_version`, and appends a record in `document_versions`.

### Tiptap JSON Canonical Format

Documents are stored natively as structured JSON Abstract Syntax Trees (AST). Plain text is extracted into `content_text` strictly for full-text search indexing.

```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "Getting Started" }]
    },
    {
      "type": "paragraph",
      "content": [{ "type": "text", "text": "Welcome to the documentation." }]
    }
  ]
}
```

### Autosave & Local Draft Recovery

- **Debounced Autosave**: Editor changes trigger a 1500ms debounced PUT request updating only `content` and `content_text`.
- **Local Storage Recovery**: Drafts are continuously cached in the browser's `localStorage` alongside the document's `updatedAt` timestamp.
- **Conflict Resolution Dialog**: If the user reopens a document and local unsaved changes exist while the server timestamp matches, the user is offered a 1-click restore. If the server was modified by another editor, a side-by-side conflict choice is presented.

### Version Checkpoints & Safe Restoration

- Versions are **never created on autosave** (preventing database bloat).
- Versions are created on:
  1. **Publish**
  2. **Explicit Checkpoint ("Save Version" dialog with change summary)**
- **Restoration is Safe**: Restoring version $N$ first creates a backup snapshot of the current state before rolling back, making version restores fully undoable.

### Soft Delete & Trash Lifecycle

- Navigation nodes and documents set `deleted_at = NOW()`.
- Soft-deleted items vanish from the active sidebar and search index.
- The **Trash Management Screen** (`/trash`) allows:
  - **Restore**: Re-attaches item to parent (or places at root if original parent was hard-deleted).
  - **Permanent Delete**: Cascades removal of document versions, navigation paths, and records.

---

## 7. Rich Text Editor Subsystem

### Editor Architecture & Extensions

The editor (`src/components/editor/DocumentEditor.tsx`) is built on Tiptap v3 with a modular extension pipeline:
- **StarterKit**: Paragraphs, Headings (H1–H6), BulletList, OrderedList, Blockquote, CodeBlock, HorizontalRule.
- **Formatting**: Underline, Color, Highlight, TextStyle, TextAlign.
- **Tables**: `Table`, `TableRow`, `TableCell`, `TableHeader` with interactive column/row controls.
- **Code Highlighting**: `CodeBlockLowlight` using `lowlight` and highlight.js themes.
- **Interactive Helpers**: `Placeholder`, `CharacterCount`, `Link`, `Image`.

### Contextual UX: Bubble Menu & Slash Commands

Instead of an overwhelming fixed top toolbar, the editor delivers a distraction-free authoring experience:

1. **Contextual Bubble Menu**: Pops up when selecting text, offering inline formatting (Bold, Italic, Code, Link, Color, Align).
2. **Slash Commands (`/`)**: Typing `/` opens a fast fuzzy-search command palette for inserting blocks:
   - Headings 1–3
   - Bulleted / Numbered lists
   - Code blocks with language pickers
   - Tables (with default 3x3 layout)
   - Callout alert boxes (Info, Warning, Tip, Danger)
   - Image upload & media library picker

### Custom Block Nodes

Custom structural nodes are implemented as native Tiptap extensions:
- **Callout Block**: Visual alert container with type styles (`info`, `warning`, `tip`, `danger`) and icon headers.
- **API Blocks & Tabs**: Formatted containers for endpoint methods (`GET`, `POST`), parameters, and multi-language code tabs.

### View/Edit Typography & Layout Parity

The Document Viewer (`src/components/documents/DocumentViewer.tsx`) and Document Editor share exact typography metrics, max-width constraints (`max-w-4xl`), prose styles, and table borders. Toggling between edit and view modes introduces **zero layout shift**.

---

## 8. Authentication, Authorization & Security

### Stateless HMAC Session System

Authentication is lightweight and requires no server-side session table:
1. User logs in with email & password (verified via `bcryptjs`).
2. Server issues a cryptographically signed HMAC-SHA256 cookie (`doc_session`) containing:
   ```json
   {
     "sub": "user-uuid",
     "email": "user@example.com",
     "role": "ADMIN",
     "exp": 1780000000
   }
   ```
3. Tamper-evident: any modification to payload or signature immediately invalidates the session.

### Role-Based Access Control (RBAC) Matrix

| Feature / Action | VIEWER | EDITOR | ADMIN |
|---|:---:|:---:|:---:|
| Read Published Documents & Search | ✅ | ✅ | ✅ |
| View Document Version History | ✅ | ✅ | ✅ |
| Create / Edit Document Drafts | ❌ | ✅ | ✅ |
| Publish Documents | ❌ | ✅ | ✅ |
| Create / Reorder / Rename Navigation Nodes | ❌ | ✅ | ✅ |
| Upload Media Assets | ❌ | ✅ | ✅ |
| Move Items to Trash / Restore from Trash | ❌ | ✅ | ✅ |
| Permanently Empty Trash | ❌ | ❌ | ✅ |
| User Management (Promote / Demote / Delete) | ❌ | ❌ | ✅ |
| View System Audit Logs & Cleanup | ❌ | ❌ | ✅ |

### Service-Layer Security Enforcement

Permissions are checked **inside domain services**, not just route handlers or UI conditionals:

```typescript
// Example from NavigationService
export async function moveNode(actor: SessionUser, input: MoveNavInput) {
  if (actor.role === "VIEWER") {
    throw new ForbiddenError("Viewers cannot modify navigation structure");
  }
  // ... execute move logic
}
```

---

## 9. Full-Text Search Engine

### PostgreSQL Full-Text Search (`tsvector` & GIN)

Search does not require external Elasticsearch or Algolia clusters. It leverages native PostgreSQL full-text search:

1. `documents.content_text` stores a sanitized plain-text string of the document body.
2. A GIN index indexes:
   ```sql
   to_tsvector('english', coalesce(title, '') || ' ' || coalesce(contentText, ''))
   ```
3. Queries use `websearch_to_tsquery('english', query)` to support phrases, quotes, and prefix matching.
4. Results are scored and ranked with `ts_rank_cd` and highlighted using `ts_headline`.

### Global Command Palette (`SearchCommand`)

- Activated anywhere via `Ctrl + K` or `Cmd + K`.
- Instant search across document titles and content.
- Direct keyboard navigation with arrow keys and `Enter` to open.

---

## 10. Media Asset Management

- **Storage**: Local filesystem storage under `public/uploads/` with UUID-based collision-free filenames.
- **Metadata**: Indexed in the `media` table with mime-type, original file name, size, and uploader references.
- **Media Picker**: Integrated directly in the editor toolbar and slash commands for 1-click image insertion.

---

## 11. Audit Logging Subsystem

Every mutation is automatically audited via `AuditService`:
- **Recorded Actions**: `USER_LOGIN`, `DOCUMENT_CREATE`, `DOCUMENT_UPDATE`, `DOCUMENT_PUBLISH`, `DOCUMENT_RESTORE`, `NAV_MOVE`, `NAV_DELETE`, `TRASH_PURGE`, `USER_ROLE_CHANGE`.
- **Metadata**: Stores diff metadata (e.g. previous parent vs new parent, old role vs new role).
- **Admin Dashboard**: `/audit` route provides paginated log inspection and cleanup tools.

---

## 12. Project & Directory Structure

```text
documentation/
├── doc/                                # System & architecture documentation
│   ├── README.md                       # Documentation index
│   └── system_documentation.md         # Comprehensive system manual
├── drizzle/                            # Database migrations (SQL)
├── scripts/                            # Operational & testing scripts
│   ├── db.sh                           # Local PostgreSQL management script
│   ├── test-fractional-index.ts        # Sort key algorithm test suite
│   ├── test-tree-flatten.ts            # Dnd tree flattening unit tests
│   ├── test-navigation.ts              # Tree CRUD & cycle protection tests
│   └── browser-smoke.ts                # Playwright end-to-end smoke tests
├── src/
│   ├── app/                            # Next.js App Router
│   │   ├── (auth)/                     # /login, /register
│   │   ├── (dashboard)/                # /documentation, /editor, /media, /users, /trash, /audit
│   │   ├── api/                        # RESTful Route Handlers
│   │   │   ├── auth/                   # Login, register, logout, session
│   │   │   ├── navigation/             # Tree CRUD, move, visibility
│   │   │   ├── documents/              # Doc CRUD, autosave, publish, versions
│   │   │   ├── search/                 # Full-text search endpoint
│   │   │   ├── media/                  # File upload & listing
│   │   │   ├── users/                  # User management & roles
│   │   │   └── audit/                  # Audit log query & cleanup
│   │   ├── globals.css                 # Theme tokens & Tailwind styles
│   │   └── layout.tsx                  # Root HTML & theme providers
│   ├── components/
│   │   ├── ui/                         # shadcn/ui components (Button, Dialog, etc.)
│   │   ├── layout/                     # AppShell, Sidebar, Footer, SearchCommand
│   │   ├── navigation/                 # Navigation tree node, actions, dialogs
│   │   ├── editor/                     # Tiptap DocumentEditor, Toolbar, BubbleMenu, Slash
│   │   └── documents/                  # DocumentViewer, OnThisPage, VersionHistory
│   ├── db/
│   │   ├── schema.ts                   # Drizzle schema definitions (6 tables + ltree)
│   │   ├── index.ts                    # PostgreSQL connection pool
│   │   ├── migrate.ts                  # Migration runner
│   │   └── seed.ts                     # Database seeder (Admin + sample docs)
│   ├── lib/
│   │   ├── auth/                       # Tokens, password hashing, RBAC permissions
│   │   ├── tree/                       # Fractional indexing, flattening, cycle logic
│   │   ├── content/                    # Plaintext extraction, Tiptap JSON helpers
│   │   ├── storage/                    # File upload filesystem handlers
│   │   └── http.ts                     # Standardized HTTP API response helpers
│   ├── schemas/                        # Zod validation schemas
│   ├── services/                       # Domain service layer (Business logic)
│   └── types/                          # Shared TypeScript interfaces
├── package.json
└── tsconfig.json
```

---

## 13. API Route Reference

### Authentication
- `POST /api/auth/login` — Authenticate and receive session cookie.
- `POST /api/auth/register` — Create new user account (defaults to `VIEWER`).
- `POST /api/auth/logout` — Clear session cookie.
- `GET /api/auth/me` — Return current authenticated actor.

### Navigation
- `GET /api/navigation` — Fetch complete visible navigation tree.
- `POST /api/navigation` — Create new navigation node (Folder, Document, Link).
- `PUT /api/navigation/[id]` — Update node title, icon, visibility, or slug.
- `POST /api/navigation/[id]/move` — Move node to new parent and sort position (atomic cycle-checked).
- `DELETE /api/navigation/[id]` — Soft-delete node to trash.

### Documents
- `GET /api/documents/[id]` — Retrieve document details and working draft content.
- `PUT /api/documents/[id]` — Autosave working draft content and title.
- `POST /api/documents/[id]/publish` — Publish current draft and increment version.
- `GET /api/documents/[id]/versions` — List historical version checkpoints.
- `POST /api/documents/[id]/versions` — Create manual checkpoint snapshot.
- `POST /api/documents/[id]/versions/[versionId]/restore` — Restore historical version.

### Search & Media
- `GET /api/search?q={query}` — Execute full-text search across documents.
- `GET /api/media` — List uploaded media assets.
- `POST /api/media/upload` — Upload multipart file asset.

### Admin & Maintenance
- `GET /api/users` / `PUT /api/users/[id]` — List users and update roles.
- `GET /api/audit` — Query audit logs with pagination and filters.
- `DELETE /api/audit/cleanup` — Prune audit logs older than specified retention.

---

## 14. Operations, Setup & Testing Runbook

### Quick Start (Local Setup)

```bash
# 1. Install dependencies
npm install

# 2. Start project-local PostgreSQL cluster (port 5433)
npm run db:start

# 3. Apply schema migrations
npm run db:migrate

# 4. Seed initial admin and sample docs tree
npm run db:seed

# 5. Launch development server
npm run dev
```

### Default Credentials
- **Admin**: `admin@local.dev` / `admin123`
- **Port**: `http://localhost:3000`

### Automated Test Suites

```bash
# Fractional indexing sort-key correctness (200k+ random insertions)
npm run test:fractional

# Navigation tree operations, moves, and cycle prevention tests
npx tsx scripts/test-navigation.ts

# Drag-and-drop tree flattening unit tests
npm run test:tree

# End-to-end browser smoke test (Playwright)
npm run test:e2e
```
