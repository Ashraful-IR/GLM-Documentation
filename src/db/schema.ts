import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The `documentation` schema holds every table of the platform.
 * Kept in its own namespace so it can never collide with app-level tables.
 */
export const documentation = pgSchema("documentation");

/**
 * PostgreSQL `ltree` column. The driver speaks to it as a plain string;
 * all ltree-specific operators (<@, subpath, nlevel, ||) are expressed
 * through raw `sql` fragments in the service layer.
 */
export const ltree = customType<{ data: string; driverData: string }>({
  dataType() {
    return "ltree";
  },
  toDriver(value: string): string {
    return value;
  },
  fromDriver(value: string): string {
    return value;
  },
});

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const userRoleEnum = pgEnum("user_role", ["ADMIN", "EDITOR", "VIEWER"]);
export const navTypeEnum = pgEnum("nav_type", ["FOLDER", "DOCUMENT", "LINK"]);
export const documentStatusEnum = pgEnum("document_status", [
  "DRAFT",
  "PUBLISHED",
]);

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

export const users = documentation.table(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: userRoleEnum("role").notNull().default("VIEWER"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique").on(table.email),
    index("users_role_idx").on(table.role),
  ],
);

// ---------------------------------------------------------------------------
// navigation — self-referencing tree, ltree path, fractional sort_key
// ---------------------------------------------------------------------------

export const navigation = documentation.table(
  "navigation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    parentId: uuid("parent_id").references((): any => navigation.id, {
      onDelete: "cascade",
    }),
    path: ltree("path").notNull(),
    type: navTypeEnum("type").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    documentId: uuid("document_id").references(() => documents.id),
    linkUrl: text("link_url"),
    icon: text("icon"),
    description: text("description"),
    sortKey: text("sort_key").notNull(),
    isVisible: boolean("is_visible").notNull().default(true),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("nav_parent_idx")
      .on(table.parentId)
      .where(sql`${table.deletedAt} IS NULL`),
    index("nav_path_idx").using("gist", table.path),
    index("nav_document_idx").on(table.documentId),
    uniqueIndex("nav_slug_unique_per_parent").on(table.parentId, table.slug),
  ],
);

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

export const documents = documentation.table(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    content: jsonb("content")
      .$type<TiptapJson>()
      .notNull()
      .default(sql`'{"type":"doc","content":[]}'::jsonb`),
    contentText: text("content_text"),
    // Last published snapshot — the reader renders this instead of `content`,
    // so autosave edits stay a draft until the document is published again.
    publishedTitle: text("published_title"),
    publishedContent: jsonb("published_content").$type<TiptapJson>(),
    status: documentStatusEnum("status").notNull().default("DRAFT"),
    currentVersion: integer("current_version").notNull().default(1),
    createdBy: uuid("created_by").references(() => users.id),
    updatedBy: uuid("updated_by").references(() => users.id),
    publishedBy: uuid("published_by").references(() => users.id),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("documents_search_idx").using(
      "gin",
      sql`to_tsvector('english', coalesce(${table.title},'') || ' ' || coalesce(${table.contentText},''))`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// document_versions — written ONLY on publish / manual checkpoint (see §13)
// ---------------------------------------------------------------------------

export const documentVersions = documentation.table(
  "document_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    title: text("title").notNull(),
    content: jsonb("content").$type<TiptapJson>().notNull(),
    changeSummary: text("change_summary"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("doc_versions_unique").on(table.documentId, table.versionNumber),
    index("doc_versions_doc_idx").on(table.documentId),
  ],
);

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

export const media = documentation.table(
  "media",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    path: text("path").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("media_uploaded_by_idx").on(table.uploadedBy)],
);

// ---------------------------------------------------------------------------
// audit_logs
// ---------------------------------------------------------------------------

export const auditLogs = documentation.table(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("audit_entity_idx").on(table.entityType, table.entityId),
    index("audit_created_at_idx").on(table.createdAt),
  ],
);

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface TiptapNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: TiptapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export interface TiptapJson {
  type: "doc";
  content?: TiptapNode[];
}

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type NavigationRow = typeof navigation.$inferSelect;
export type NewNavigation = typeof navigation.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;
export type MediaRow = typeof media.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
