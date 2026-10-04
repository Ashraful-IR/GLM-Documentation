import { ExternalLink, FileText, Folder } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/layout/BrandMark";
import { getSessionUser } from "@/lib/auth/actor";
import { getTree } from "@/services/navigation.service";

export const dynamic = "force-dynamic";

export default async function DocumentationLanding() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Viewers land on a welcome screen; admins/editors keep the management landing.
  if (user.role === "VIEWER") {
    return (
      <div className="flex min-h-full flex-col items-center justify-center px-4 py-10 text-center sm:px-8 sm:py-16">
        <p className="text-lg font-medium uppercase tracking-[0.2em] text-muted-foreground">Welcome to</p>
        <BrandMark size="lg" className="mt-6 h-14" />
        <h1 className="mt-6 text-3xl font-semibold tracking-tight sm:text-5xl">Cockpit GLM</h1>
        <p className="mt-4 max-w-lg text-base leading-relaxed text-muted-foreground">
          Explore the documentation to learn how the platform works — browse the guides and references from
          the sidebar to get started.
        </p>
      </div>
    );
  }

  const tree = await getTree({ id: user.id, role: user.role });
  const roots = tree.filter((n) => n.parentId === null);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-8 sm:py-14">
      <div className="mb-8 flex items-center gap-3">
        <BrandMark size="lg" />
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Documentation</h1>
          <p className="text-sm text-muted-foreground">
            Pick a document from the sidebar, or create a new page.
          </p>
        </div>
      </div>

      {roots.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No documentation yet. Use the <span className="font-medium text-foreground">+</span> button in the sidebar to
            add a folder or page.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {roots.map((node) => {
            const href =
              node.type === "LINK" ? node.linkUrl ?? "#" : `/documentation/${node.slug}`;
            const Icon = node.type === "FOLDER" ? Folder : node.type === "LINK" ? ExternalLink : FileText;
            return (
              <Link
                key={node.id}
                href={href}
                target={node.type === "LINK" ? "_blank" : undefined}
                className="group flex items-start gap-3 rounded-xl border p-4 transition-colors hover:bg-accent/50"
              >
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{node.title}</p>
                  {node.description && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{node.description}</p>
                  )}
                  {node.type === "FOLDER" && node.children.length > 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">{node.children.length} item(s) inside</p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
