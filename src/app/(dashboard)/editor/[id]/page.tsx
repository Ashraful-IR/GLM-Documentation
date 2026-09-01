import { notFound, redirect } from "next/navigation";

import { EditorWorkspace } from "@/components/editor/EditorWorkspace";
import { getSessionUser } from "@/lib/auth/actor";
import { getDocument, findNavNodeForDocument } from "@/services/document.service";
import { findFallbackNodeAfterDelete, getSlugPath } from "@/services/navigation.service";
import { ApiError } from "@/lib/http";

export const dynamic = "force-dynamic";

export default async function EditorPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const actor = { id: user.id, role: user.role };

  if (actor.role === "VIEWER") {
    redirect("/documentation");
  }

  const { id } = await params;
  let doc;
  try {
    doc = await getDocument(actor, id);
  } catch (err) {
    // The document was deleted — send the user to the next document in the
    // tree instead of a 404.
    if (err instanceof ApiError && err.status === 404) {
      const nav = await findNavNodeForDocument(id);
      if (nav) {
        const fallback = await findFallbackNodeAfterDelete(actor, nav.id);
        if (fallback) redirect(`/documentation/${await getSlugPath(actor, fallback.id)}`);
      }
      notFound();
    }
    throw err;
  }

  const nav = await findNavNodeForDocument(id);
  const backHref = nav ? `/documentation/${await getSlugPath(actor, nav.id)}` : "/documentation";

  return (
    <EditorWorkspace
      documentId={doc.id}
      initialTitle={doc.title}
      initialContent={doc.content as import("@/types/editor").TiptapDocument}
      serverUpdatedAt={doc.updatedAt}
      status={doc.status}
      currentVersion={doc.currentVersion}
      backHref={backHref}
      canEdit
      initialHasUnpublishedChanges={doc.hasUnpublishedChanges}
    />
  );
}
