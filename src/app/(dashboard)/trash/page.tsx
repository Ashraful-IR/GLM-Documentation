"use client";

import { useCallback, useEffect, useState } from "react";
import { EyeOff, FileText, Folder, Link2, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Api, ClientError } from "@/lib/api/client";
import { useNavigation } from "@/hooks/useNavigation";
import type { NavigationNode } from "@/types";

interface FlattenedDeletedNode extends NavigationNode {
  path: string;
}

function flattenDeleted(nodes: NavigationNode[]): FlattenedDeletedNode[] {
  const out: FlattenedDeletedNode[] = [];
  const walk = (list: NavigationNode[], pathPrefix: string[]) => {
    for (const n of list) {
      const currentPath = n.displayPath || [...pathPrefix, n.title].join(" / ");
      out.push({ ...n, path: currentPath });
      walk(n.children, [...pathPrefix, n.title]);
    }
  };
  walk(nodes, []);
  return out;
}

function getNodeIcon(type: "FOLDER" | "DOCUMENT" | "LINK") {
  switch (type) {
    case "FOLDER":
      return <Folder className="size-4 shrink-0 text-muted-foreground" />;
    case "DOCUMENT":
      return <FileText className="size-4 shrink-0 text-muted-foreground" />;
    case "LINK":
      return <Link2 className="size-4 shrink-0 text-muted-foreground" />;
  }
}

export default function TrashPage() {
  const { tree, refresh, deleteNode, restoreNode, emptyTrash } = useNavigation();
  const [trash, setTrash] = useState<NavigationNode[]>([]);
  const [hidden, setHidden] = useState<NavigationNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isEmptying, setIsEmptying] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [t, h] = await Promise.all([Api.getTrash(), Api.getTree()]);
      setTrash(t);
      setHidden(h);
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Failed to load trash");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred one tick so the initial load isn't a synchronous
    // setState-in-effect (react-hooks lint rule).
    const t = setTimeout(() => { void loadData(); }, 0);
    return () => clearTimeout(t);
  }, [loadData, tree]);

  const handleRestore = async (node: FlattenedDeletedNode) => {
    setRestoringId(node.id);
    try {
      await restoreNode(node.id);
      toast.success(`Restored “${node.title}”`);
      await loadData();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Failed to restore");
    } finally {
      setRestoringId(null);
    }
  };

  const handleDeletePermanently = async (node: FlattenedDeletedNode) => {
    const isFolder = node.type === "FOLDER";
    const promptMessage = isFolder
      ? `Permanently delete folder “${node.title}” and everything inside it? This cannot be undone.`
      : `Permanently delete “${node.title}”? This cannot be undone.`;

    if (!window.confirm(promptMessage)) return;

    setDeletingId(node.id);
    try {
      await deleteNode(node.id, true);
      toast.success(`Permanently deleted “${node.title}”`);
      await loadData();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Failed to delete");
    } finally {
      setDeletingId(null);
    }
  };

  const handleEmptyTrash = async () => {
    if (
      !window.confirm(
        "Are you sure you want to empty the trash? All items will be permanently deleted and cannot be recovered."
      )
    ) {
      return;
    }

    setIsEmptying(true);
    try {
      await emptyTrash();
      toast.success("Trash emptied");
      await loadData();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Failed to empty trash");
    } finally {
      setIsEmptying(false);
    }
  };

  const deletedRows = flattenDeleted(trash);
  const hiddenRows = flattenDeleted(hidden.filter((n) => !n.isVisible || n.effectivelyHidden));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Trash & hidden</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deleted items are soft-deleted and stored in the trash. You can restore them or permanently delete them.
          </p>
        </div>
        {deletedRows.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            className="gap-1.5"
            onClick={handleEmptyTrash}
            disabled={isEmptying}
          >
            {isEmptying ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            Empty trash
          </Button>
        )}
      </div>

      <Tabs defaultValue="deleted" className="mt-6">
        <TabsList>
          <TabsTrigger value="deleted">Deleted ({deletedRows.length})</TabsTrigger>
          <TabsTrigger value="hidden">Hidden ({hiddenRows.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="deleted" className="mt-4">
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </div>
          ) : deletedRows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <Trash2 className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-medium">Nothing in the trash</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Soft-deleted pages and folders will appear here until permanently deleted.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {deletedRows.map((node) => {
                const isRestoring = restoringId === node.id;
                const isDeleting = deletingId === node.id;
                const isBusy = isRestoring || isDeleting;

                const deletedDateStr = node.deletedAt
                  ? new Date(node.deletedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : null;

                return (
                  <li
                    key={node.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      {getNodeIcon(node.type)}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{node.title}</p>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">{node.path}</span>
                          {deletedDateStr && (
                            <>
                              <span>•</span>
                              <span>Deleted {deletedDateStr}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex w-full items-center gap-2 sm:w-auto">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        disabled={isBusy}
                        onClick={() => handleRestore(node)}
                      >
                        {isRestoring ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="size-3.5" />
                        )}
                        <span className="hidden sm:inline">Restore</span>
                        <span className="sm:hidden">Undo</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
                        disabled={isBusy}
                        onClick={() => handleDeletePermanently(node)}
                      >
                        {isDeleting ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                        <span className="hidden sm:inline">Delete permanently</span>
                        <span className="sm:hidden">Delete</span>
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="hidden" className="mt-4">
          {hiddenRows.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center">
              <EyeOff className="mx-auto size-8 text-muted-foreground/50" />
              <p className="mt-2 text-sm font-medium">No hidden items</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Items hidden from the sidebar will appear here.
              </p>
            </div>
          ) : (
            <ul className="space-y-2">
              {hiddenRows.map((node) => (
                <li
                  key={node.id}
                  className="flex items-center gap-3 rounded-lg border bg-card p-3 shadow-xs"
                >
                  <EyeOff className="size-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{node.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{node.path}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={async () => {
                      await refresh();
                      await Api.updateNode(node.id, { isVisible: true });
                      toast.success(`“${node.title}” is now visible`);
                      await loadData();
                    }}
                  >
                    <EyeOff className="size-3.5" /> Show
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
