import { ArrowLeft, ArrowRight, ChevronRight, FileText, Folder, Home, Link2, Pencil } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { LazyDocumentViewer } from "@/components/documents/LazyDocumentViewer";
import { OnThisPage } from "@/components/documents/OnThisPage";
import { extractHeadings } from "@/lib/content/headings";
import { getSessionUser } from "@/lib/auth/actor";
import { ApiError } from "@/lib/http";
import { findBySlugPath, findFallbackNodeAfterDelete, getSlugPath, getTree } from "@/services/navigation.service";
import { getDocument } from "@/services/document.service";
import { getUserById } from "@/services/user.service";
import type { NavigationNode } from "@/types";

function findInTree(nodes: NavigationNode[], id: string): NavigationNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findInTree(n.children, id);
    if (found) return found;
  }
  return null;
}

/** Ancestor chain from a root down to (and including) the target node. */
function findPath(tree: NavigationNode[], targetId: string): NavigationNode[] {
  for (const n of tree) {
    if (n.id === targetId) return [n];
    const found = findPath(n.children, targetId);
    if (found.length > 0) return [n, ...found];
  }
  return [];
}

function slugPathMap(tree: NavigationNode[]): Map<string, string> {
  const map = new Map<string, string>();
  const walk = (nodes: NavigationNode[], prefix: string[]) => {
    for (const n of nodes) {
      const path = [...prefix, n.slug];
      map.set(n.id, path.join("/"));
      walk(n.children, path);
    }
  };
  walk(tree, []);
  return map;
}

/** All documents in tree display order — used for Previous/Next navigation. */
function flattenDocuments(nodes: NavigationNode[], out: NavigationNode[] = []): NavigationNode[] {
  for (const n of nodes) {
    if (n.type === "DOCUMENT" && n.documentId) out.push(n);
    flattenDocuments(n.children, out);
  }
  return out;
}

export const dynamic = "force-dynamic";

export default async function DocumentationView({ params }: { params: Promise<{ slug: string[] }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const actor = { id: user.id, role: user.role };
  const slugs = (await params).slug;

  const node = await findBySlugPath(actor, slugs);
  if (!node) {
    // The page was deleted — show the next document instead of a 404.
    // Fetch the tree once and reuse it for fallback computation.
    const [deleted, tree] = await Promise.all([
      findBySlugPath(actor, slugs, { includeDeleted: true }),
      getTree(actor),
    ]);
    if (deleted) {
      const fallback = await findFallbackNodeAfterDelete(actor, deleted.id, tree);
      if (fallback) redirect(`/documentation/${await getSlugPath(actor, fallback.id)}`);
    }
    notFound();
  }

  if (node.type === "LINK" && node.linkUrl) redirect(node.linkUrl);
  if (node.type === "FOLDER") {
    const tree = await getTree(actor);
    const folderNode = findInTree(tree, node.id);
    const children = folderNode?.children ?? [];
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8 sm:py-14">
        <div className="mb-6 flex items-center gap-2">
          <Folder className="size-4 text-muted-foreground" />
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{node.title}</h1>
        </div>
        <ul className="space-y-2">
          {children.map((child) => (
            <li key={child.id}>
              <Link
                href={
                  child.type === "DOCUMENT"
                    ? `/documentation/${slugs.join("/")}/${child.slug}`
                    : child.linkUrl ?? "#"
                }
                target={child.type === "LINK" ? "_blank" : undefined}
                className="flex items-center gap-2 rounded-lg border px-4 py-3 text-sm transition-colors hover:bg-accent/50"
              >
                {child.type === "DOCUMENT" ? (
                  <FileText className="size-3.5 text-muted-foreground" />
                ) : (
                  <Link2 className="size-3.5 text-muted-foreground" />
                )}
                <span className="font-medium">{child.title}</span>
                <span className="ml-auto text-xs text-muted-foreground">{child.children.length} item(s)</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (!node.documentId) notFound();

  // Fetch document and tree in parallel — they are independent.
  let doc;
  let tree;
  try {
    [doc, tree] = await Promise.all([
      getDocument(actor, node.documentId),
      getTree(actor),
    ]);
  } catch (err) {
    // Node still visible but its document is gone (soft-deleted separately) —
    // redirect to the next document rather than a 404.
    if (err instanceof ApiError && err.status === 404) {
      // Tree may or may not have resolved; fetch if needed.
      if (!tree) tree = await getTree(actor);
      const fallback = await findFallbackNodeAfterDelete(actor, node.id, tree);
      if (fallback) redirect(`/documentation/${await getSlugPath(actor, fallback.id)}`);
      notFound();
    }
    throw err;
  }
  // Readers see ONLY the published snapshot — edits in the editor never appear
  // until the document is published again. A never-published doc has no
  // snapshot, so its draft content must not leak to the reader either.
  const isPublished = doc.publishedTitle !== null && doc.publishedContent !== null;
  const content = (isPublished ? doc.publishedContent : { type: "doc", content: [] }) as import("@/types/editor").TiptapDocument;

  // The right-hand "On This Page" panel is generated from the published
  // content's headings — never stored or edited manually.
  const tocItems = isPublished ? extractHeadings(content) : [];

  const canEdit = actor.role === "ADMIN" || actor.role === "EDITOR";

  // Kick off author fetch now — we'll do synchronous tree math while it runs.
  const authorPromise = doc.updatedBy
    ? getUserById(doc.updatedBy).then((u) => u.name).catch(() => null)
    : Promise.resolve(null);

  // Breadcrumbs and Previous/Next are derived from the navigation tree.
  const paths = slugPathMap(tree);
  const path = findPath(tree, node.id);
  const crumbs = path.slice(0, -1);
  const childPages = path.length > 0 ? path[path.length - 1].children : [];

  const docs = flattenDocuments(tree);
  const idx = docs.findIndex((d) => d.id === node.id);
  const prev = idx > 0 ? docs[idx - 1] : null;
  const next = idx >= 0 && idx < docs.length - 1 ? docs[idx + 1] : null;

  // Now await the author result — it has been running in parallel with the
  // synchronous tree computations above.
  const authorName = await authorPromise;

  return (
    <div className="min-h-full">
      <div className="flex w-full items-start gap-4 px-4 py-6 sm:gap-6 sm:px-6 sm:py-8 lg:gap-8 lg:px-8 lg:py-10">
        {/* Center column — the article is centered (max-w-[820px]) inside the
            space between the sidebar and the right TOC, so the gap to each
            panel stays equal at every viewport width. */}
        <div className="min-w-0 flex-1">
          <div className="mx-auto w-full max-w-[820px] px-2 sm:px-0">
          <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Link href="/documentation" className="flex items-center gap-1 transition-colors hover:text-foreground">
              <Home className="size-3.5" /> Home
            </Link>
            {crumbs.map((c) => (
              <span key={c.id} className="flex items-center gap-1.5">
                <ChevronRight className="size-3.5" />
                <Link
                  href={`/documentation/${paths.get(c.id) ?? c.slug}`}
                  className="transition-colors hover:text-foreground"
                >
                  {c.title}
                </Link>
              </span>
            ))}
            <ChevronRight className="size-3.5" />
            <span className="font-medium text-foreground">{node.title}</span>
          </nav>

          <h1 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">{isPublished ? (doc.publishedTitle ?? doc.title) : node.title}</h1>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
            {isPublished ? (
              <>
                <span>Last updated: {new Date(doc.publishedAt ?? doc.updatedAt).toLocaleDateString()}</span>
                {authorName && <span>By {authorName}</span>}
              </>
            ) : (
              <span>Draft — not published yet</span>
            )}
            {canEdit && (
              <Button asChild size="sm" variant="outline" className="ml-auto gap-1.5">
                <Link href={`/editor/${doc.id}`}>
                  <Pencil className="size-3.5" /> Edit
                </Link>
              </Button>
            )}
          </div>

          <div className="mt-8">
            {isPublished ? (
              <LazyDocumentViewer variant="reader" content={content} headings={tocItems} />
            ) : (
              <div className="rounded-lg border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
                This page hasn&apos;t been published yet. Its content is only visible in the editor until it is published.
              </div>
            )}
          </div>

          {/* Child pages — separate documents/folders attached under this one */}
          {childPages.length > 0 && (
            <section className="mt-8 sm:mt-12">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Child pages</h2>
              <ul className="mt-3 grid gap-2 grid-cols-1 sm:grid-cols-2">
                {childPages.map((child) => {
                  const Icon = child.type === "FOLDER" ? Folder : child.type === "LINK" ? Link2 : FileText;
                  const href =
                    child.type === "LINK" ? child.linkUrl ?? "#" : `/documentation/${paths.get(child.id) ?? child.slug}`;
                  return (
                    <li key={child.id}>
                      <Link
                        href={href}
                        target={child.type === "LINK" ? "_blank" : undefined}
                        className="group flex items-start gap-2.5 rounded-lg border p-3 transition-colors hover:bg-accent/50"
                      >
                        <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{child.title}</span>
                          {child.description && (
                            <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
                              {child.description}
                            </span>
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {(prev || next) && (
            <div className="mt-8 flex flex-col gap-3 border-t pt-6 sm:mt-12 sm:flex-row sm:items-stretch sm:justify-between sm:gap-4">
              {prev ? (
                <Link
                  href={`/documentation/${paths.get(prev.id) ?? prev.slug}`}
                  className="group flex max-w-full flex-col gap-1 rounded-lg border p-3 transition-colors hover:bg-accent/50 sm:max-w-[45%] sm:p-4"
                >
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <ArrowLeft className="size-3" /> Previous
                  </span>
                  <span className="truncate text-sm font-medium group-hover:text-foreground">{prev.title}</span>
                </Link>
              ) : (
                <span className="flex-1" />
              )}
              {next ? (
                <Link
                  href={`/documentation/${paths.get(next.id) ?? next.slug}`}
                  className="group flex max-w-full flex-col items-end gap-1 rounded-lg border p-3 text-right transition-colors hover:bg-accent/50 sm:ml-auto sm:max-w-[45%] sm:p-4"
                >
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    Next <ArrowRight className="size-3" />
                  </span>
                  <span className="truncate text-sm font-medium group-hover:text-foreground">{next.title}</span>
                </Link>
              ) : (
                <span className="flex-1" />
              )}
            </div>
          )}
          </div>
        </div>

        {/* Right column — sticky table of contents (desktop only). It caps at
            the viewport height below the navbar and scrolls independently when
            the heading list is long; the center column scrolls beneath it. */}
        {tocItems.length > 0 && (
          <OnThisPage
            items={tocItems}
            className="sticky top-0 hidden max-h-[calc(100dvh-3rem)] w-80 shrink-0 overflow-y-auto lg:block"
          />
        )}
      </div>
    </div>
  );
}
