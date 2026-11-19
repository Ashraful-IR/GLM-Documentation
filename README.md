# Documentation Platform

A local-first documentation management application built from the
`documentation_platform_architecture_v2.md` specification.

**Navigation → Document → Tiptap Content** — a self-referencing navigation
tree (ltree materialized paths, fractional sort keys) that points at documents
stored as Tiptap JSON in PostgreSQL, with a rich editor, versioning, search,
and role-based access — all running locally.

## Stack

Next.js 16 (App Router) · TypeScript (strict) · Tailwind CSS · shadcn/ui ·
Tiptap v3 · PostgreSQL (with `ltree`) · Drizzle ORM · Zod · dnd-kit ·
Zustand (available for client state)

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Start the project-local PostgreSQL cluster (port 5433, no root needed)
npm run db:start

# 3. Create the schema (6 tables + ltree + indexes)
npm run db:migrate

# 4. Seed: admin user + sample documentation tree
npm run db:seed

# 5. Run the app
npm run dev            # http://localhost:3000
```

**Sign in:** `admin@local.dev` / `admin123` (Admin). Registering a new account
creates a Viewer; promote users to Editor/Admin on the **Users** page.

> The database runs from `.local/pg` — a private cluster that needs no system
> privileges. `npm run db:stop` shuts it down. Everything is local; no cloud
> infrastructure is used.

## Key design points (from the spec)

- **6 tables** in the `documentation` schema: `users`, `navigation`,
  `documents`, `document_versions`, `media`, `audit_logs`.
- **Navigation tree**: self-referencing `parent_id` + `ltree` materialized
  `path` (fast subtree queries, cycle-safe moves) + fractional lexicographic
  `sort_key` (O(1) reordering with automatic rebalance).
- **Moves are transactional**: row locks → cycle check → sort key →
  one-statement path rewrite for the whole subtree.
- **Tiptap JSON is the canonical content format**; `content_text` (plain-text
  mirror) powers PostgreSQL full-text search via a GIN index.
- **Explicit version-write policy**: autosave never writes a version row;
  versions are created only on **Publish** or **Save version** (checkpoint).
  Restoring a version snapshots the current state first, so restores are
  undoable.
- **Soft delete everywhere** — navigation and documents move to trash and can
  be restored; hard delete only via the explicit trash action.
- **3-layer architecture**: Route Handler → Service (validation + permission
  check + Drizzle) → PostgreSQL. No repository indirection.
- **Permissions**: a `role` enum (`ADMIN` / `EDITOR` / `VIEWER`) with
  code-level checks enforced inside every service method — never only in the UI.
- **Session auth**: stateless HMAC-signed cookie; no sessions table.

## Editor

- No fixed toolbar — contextual **bubble menu** (text selection) + **`/`
  slash commands** for insertion.
- Blocks: headings, lists, code blocks (highlight.js via lowlight), tables,
  callouts, blockquotes, images, links, alignment, colors.
- **Autosave** (debounced, content only) with a save-state indicator
  (`Saving…` / `Saved ✓` / `Unsaved changes` / `Save failed`).
- **Draft recovery**: drafts are cached in localStorage with a snapshot of the
  server `updated_at`; on reopen, an unchanged server copy offers restore,
  while a moved-on server copy shows an explicit conflict choice (§21).
- Edit/view parity: the viewer renders the same content column width and
  typography, so toggling modes causes no layout shift.

## Scripts

| Command | Purpose |
|---|---|
| `npm run db:start` / `db:stop` | Start/stop the local PostgreSQL cluster |
| `npm run db:migrate` | Apply `drizzle/*.sql` migrations |
| `npm run db:seed` | Seed admin + sample docs (idempotent) |
| `npm run db:setup` | Start + migrate + seed in one shot |
| `npm run test:fractional` | Property tests for the sort-key algorithm |
| `npx tsx scripts/test-navigation.ts` | Service integration tests (needs a running DB) |
| `npx tsx scripts/test-tree-flatten.ts` | Unit tests for the dnd tree model |
| `npx tsx scripts/browser-smoke.ts` | Headless-browser E2E (needs app on :3000) |

## Project layout

```
src/
├── app/
│   ├── (auth)/{login,register}/
│   ├── (dashboard)/documentation/[...slug], editor/[id], media, users, settings, trash, audit
│   └── api/{auth,navigation,documents,search,media,users,audit}/
├── components/{ui, navigation, editor, documents, layout}/
├── services/          # navigation, document, version, search, media, user, audit
├── db/                # Drizzle schema + migration runner + seed
├── lib/{auth, docx, content, storage, http, tree}/
├── schemas/           # Zod validation
├── hooks/
└── types/
```

## DOCX

Import/export is isolated behind the adapter in `src/lib/docx/` (§7) so the
core document model never depends on DOCX internals. The adapter currently
degrades gracefully with a clear `DocxUnsupportedError`; wire a library into
`importDocx` / `exportDocx` when the feature is scheduled.

## Tests

```bash
npm run test:fractional          # sort-key correctness (200k+ random cases)
npx tsx scripts/test-navigation.ts    # tree CRUD / move / cycle / restore
npx tsx scripts/test-tree-flatten.ts  # drag & drop model
npx tsx scripts/browser-smoke.ts      # full UI flow in headless Brave/Chromium
```

## Deploying to Vercel

The project installs with **npm** (`package-lock.json`, pinned via `packageManager`) on **Node 22**.
Don't commit a `pnpm-lock.yaml`: Vercel would switch to pnpm and fail when it drifts out of sync.

Vercel runs the `vercel-build` script, which on **production** deploys first runs the database
deploy step (`src/db/deploy.ts`): apply pending migrations, add the starter teams/designations
if empty, and create the first admin if it doesn't exist. Preview deploys skip it, so a pull
request never changes the production database.

Set these in **Vercel → Project → Settings → Environment Variables** (Production):

| Variable | Value |
|---|---|
| `DATABASE_URL` | Production Postgres URL (must accept connections from Vercel) |
| `AUTH_SECRET` | Long random string, e.g. `openssl rand -base64 48` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | First admin account (password ≥ 8 chars); only used if that email doesn't exist yet |
| `ADMIN_NAME` | Optional display name |

The build log shows what happened (`[db:deploy] …` lines). For Docker deployments, see `DOCKER.md` §8.
