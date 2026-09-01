"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ChevronRight, FileText, Folder, Link2, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { flattenTree, applyDragOver, computeDropTarget, wouldCreateCycle, indentWidth, type FlatItem } from "@/lib/tree/flatten";
import { findFallbackAfterDelete } from "@/lib/tree/fallback";
import { STORAGE_KEYS, getItem, setItem } from "@/lib/storage/local-storage";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { ClientError } from "@/lib/api/client";
import type { NavigationNode, UserRole } from "@/types";
import { NodeActions, type NodeActionCallbacks } from "./NodeActions";
import {
  DeleteNodeDialog,
  HideDialog,
  NewItemDialog,
  PublishDialog,
  RenameDialog,
} from "./dialogs";

const CAN_EDIT: Record<UserRole, boolean> = {
  ADMIN: true,
  EDITOR: true,
  VIEWER: false,
};

export interface SidebarMutations {
  createNode: (input: { parentId: string | null; type: "FOLDER" | "DOCUMENT" | "LINK"; title: string; slug: string; linkUrl?: string | null }) => Promise<void>;
  updateNode: (id: string, patch: Record<string, unknown>) => Promise<void>;
  moveNode: (id: string, target: { parentId: string | null; prevId?: string | null; nextId?: string | null }) => Promise<void>;
  deleteNode: (id: string, permanent?: boolean) => Promise<void>;
  duplicateNode: (id: string) => Promise<void>;
}

interface SidebarProps {
  tree: NavigationNode[];
  loading: boolean;
  role: UserRole;
  mutations: SidebarMutations;
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

function findNode(tree: NavigationNode[], id: string): NavigationNode | null {
  for (const n of tree) {
    if (n.id === id) return n;
    const found = findNode(n.children, id);
    if (found) return found;
  }
  return null;
}

/** True when `ancestorId` sits above `nodeId` in the tree. */
function isAncestorOf(tree: NavigationNode[], ancestorId: string, nodeId: string): boolean {
  let cur = findNode(tree, nodeId);
  while (cur?.parentId) {
    if (cur.parentId === ancestorId) return true;
    cur = findNode(tree, cur.parentId);
  }
  return false;
}

export function Sidebar({ tree, loading, role, mutations }: SidebarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const canEdit = CAN_EDIT[role];
  const slugPaths = useMemo(() => slugPathMap(tree), [tree]);

  // The navigation node currently open in the main panel (viewer or editor),
  // so deleting it from the sidebar can move the user to the next document
  // instead of leaving a stale page that 404s on refresh.
  const currentNodeId = useMemo(() => {
    if (pathname.startsWith("/documentation/")) {
      const slugPath = pathname.slice("/documentation/".length);
      for (const [id, sp] of slugPaths) {
        if (sp === slugPath) return id;
      }
      return null;
    }
    if (pathname.startsWith("/editor/")) {
      const documentId = pathname.slice("/editor/".length);
      const walk = (nodes: NavigationNode[]): NavigationNode | null => {
        for (const n of nodes) {
          if (n.documentId === documentId) return n;
          const found = walk(n.children);
          if (found) return found;
        }
        return null;
      };
      return walk(tree)?.id ?? null;
    }
    return null;
  }, [pathname, slugPaths, tree]);

  const [expanded, setExpanded] = useLocalStorage<Record<string, boolean>>(STORAGE_KEYS.sidebarState, {});
  const collapsed = useMemo(() => new Set(Object.keys(expanded).filter((k) => expanded[k] === false)), [expanded]);

  const [items, setItems] = useState<FlatItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const draggingRef = useRef(false);

  // Keep the flat list in sync with the server tree (unless actively dragging).
  useEffect(() => {
    if (!draggingRef.current) setItems(flattenTree(tree, collapsed));
  }, [tree, collapsed]);

  // Dialog state
  const [newParent, setNewParent] = useState<NavigationNode | null | "root">(null);
  const [renameNode, setRenameNode] = useState<NavigationNode | null>(null);
  const [deleteNode, setDeleteNode] = useState<NavigationNode | null>(null);
  const [hideNode, setHideNode] = useState<NavigationNode | null>(null);
  const [publishNode, setPublishNode] = useState<NavigationNode | null>(null);
  const [hoverExpandTimer, setHoverExpandTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !(prev[id] ?? true) }));
  }

  function navigate(node: NavigationNode) {
    if (node.type === "LINK" && node.linkUrl) {
      window.open(node.linkUrl, "_blank");
      return;
    }
    // Folders open their index page (children stay expandable via the chevron).
    router.push(`/documentation/${slugPaths.get(node.id) ?? node.slug}`);
  }

  const actionHandlers: NodeActionCallbacks = {
    onAddChild: (node) => setNewParent(node),
    onRename: (node) => setRenameNode(node),
    onDelete: (node) => setDeleteNode(node),
    onHide: (node) => setHideNode(node),
    onDuplicate: async (node) => {
      try {
        await mutations.duplicateNode(node.id);
        toast.success("Duplicated");
      } catch (err) {
        toast.error(err instanceof ClientError ? err.message : "Failed to duplicate");
      }
    },
    onPublish: (node) => setPublishNode(node),
  };

  /**
   * Deletes a node and keeps the open view consistent: if the deletion
   * removes the node currently on screen (or one of its ancestors), navigate
   * to the next document in display order; otherwise just refresh the page so
   * stale folder listings update immediately.
   */
  async function handleDeleteNode(id: string, permanent = false) {
    const deleted = findNode(tree, id);
    const affectsOpenView =
      deleted && currentNodeId !== null && (id === currentNodeId || isAncestorOf(tree, id, currentNodeId));
    if (affectsOpenView) {
      const fallbackId = findFallbackAfterDelete(tree, id);
      await mutations.deleteNode(id, permanent);
      if (fallbackId) {
        const fallbackPath = slugPaths.get(fallbackId);
        router.push(fallbackPath ? `/documentation/${fallbackPath}` : "/documentation");
      } else {
        router.push("/documentation");
      }
      return;
    }
    await mutations.deleteNode(id, permanent);
    // The open page may still reference the deleted node (e.g. a folder index
    // listing it) — re-fetch the current route so it reflects the tree.
    router.refresh();
  }

  async function handleDragStart(e: DragStartEvent) {
    draggingRef.current = true;
    setActiveId(String(e.active.id));
  }

  function handleDragOver(e: DragOverEvent) {
    const { active, over, delta } = e;
    if (!over) return;
    const activeId_ = String(active.id);
    const overId = String(over.id);
    if (activeId_ === overId) return;

    setItems((prev) => {
      const next = applyDragOver(prev, activeId_, overId, delta.x);
      // Auto-expand the hovered folder so you can drop inside it.
      const overNode = prev.find((i) => i.id === overId);
      if (overNode?.hasChildren && collapsed.has(overId)) {
        if (hoverExpandTimer) clearTimeout(hoverExpandTimer);
        const timer = setTimeout(() => {
          setExpanded((p) => ({ ...p, [overId]: true }));
        }, 600);
        setHoverExpandTimer(timer);
      }
      return next;
    });
  }

  async function handleDragEnd(e: DragEndEvent) {
    draggingRef.current = false;
    const activeId_ = String(e.active.id);
    setActiveId(null);
    if (hoverExpandTimer) clearTimeout(hoverExpandTimer);

    if (e.over && activeId_ !== String(e.over.id)) {
      setItems((prev) => {
        const target = computeDropTarget(prev, activeId_);
        if (wouldCreateCycle(prev, activeId_, target.parentId)) {
          toast.error("Cannot move an item into itself or its descendants");
          return prev;
        }
        void mutations.moveNode(activeId_, target).catch((err) => {
          toast.error(err instanceof ClientError ? err.message : "Move failed");
        });
        return prev;
      });
    } else {
      // No-op drop — restore the server order.
      setItems(flattenTree(tree, collapsed));
    }
  }

  function handleDragCancel() {
    draggingRef.current = false;
    setActiveId(null);
    setItems(flattenTree(tree, collapsed));
  }

  const activeItem = items.find((i) => i.id === activeId);

  return (
    <div className="flex h-full flex-col">
      {/* pr-10 keeps the + button clear of the collapse toggle on the sidebar's right edge */}
      <div className="flex items-center justify-between pb-1 pl-3 pr-10 pt-0.5">
        <h2 className="px-1 text-sm font-semibold uppercase tracking-wider">CONTENT</h2>
        {canEdit && (
          <Button
            variant="ghost"
            size="icon"
            className="size-10 "
            onClick={() => setNewParent("root")}
            aria-label="Add item"
          >
            <Plus className="size-5" />
          </Button> 
        )}
      </div>
      <ScrollArea className="flex-1">
        <div className="px-5 pb-4 pt-10">
          {loading && tree.length === 0 ? (
            <div className="space-y-1.5 px-1 pt-2">
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-7 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="px-1 pt-2 text-xs text-muted-foreground">
              {tree.length === 0 ? "Nothing here yet." : "Everything is hidden."}
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              onDragCancel={handleDragCancel}
            >
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-0.5">
                  {items.map((item) => (
                    <SortableRow
                      key={item.id}
                      item={item}
                      isActive={item.id === activeId}
                      isDragging={activeItem !== undefined}
                      canEdit={canEdit}
                      expanded={!(collapsed.has(item.id) && item.hasChildren)}
                      onToggle={() => toggleExpand(item.id)}
                      onNavigate={() => {
                        const node = findNode(tree, item.id);
                        if (node) navigate(node);
                      }}
                      onAction={actionHandlers}
                      slugPath={slugPaths.get(item.id) ?? item.slug}
                      isCurrentPath={pathname === `/documentation/${slugPaths.get(item.id) ?? item.slug}`}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </div>
      </ScrollArea>

      <NewItemDialog
        open={newParent !== null}
        onOpenChange={(o) => !o && setNewParent(null)}
        parentId={newParent === "root" ? null : newParent?.id ?? null}
        parentTitle={newParent === "root" ? null : newParent?.title ?? null}
        onCreate={mutations.createNode}
      />
      <RenameDialog open={renameNode !== null} onOpenChange={(o) => !o && setRenameNode(null)} node={renameNode} mutations={mutations} />
      <DeleteNodeDialog
        open={deleteNode !== null}
        onOpenChange={(o) => !o && setDeleteNode(null)}
        node={deleteNode ? { id: deleteNode.id, title: deleteNode.title, hasChildren: deleteNode.children.length > 0 } : null}
        mutations={{ updateNode: mutations.updateNode, deleteNode: handleDeleteNode }}
      />
      <HideDialog open={hideNode !== null} onOpenChange={(o) => !o && setHideNode(null)} node={hideNode} mutations={mutations} />
      <PublishDialog
        open={publishNode !== null}
        onOpenChange={(o) => !o && setPublishNode(null)}
        documentId={publishNode?.documentId ?? null}
        onPublish={async (summary) => {
          if (!publishNode?.documentId) return;
          try {
            await fetch(`/api/documents/${publishNode.documentId}/publish`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ changeSummary: summary }),
            }).then(async (r) => {
              const b = await r.json();
              if (!b.success) throw new ClientError(b.error.code, b.error.message, r.status);
            });
            toast.success("Published");
          } catch (err) {
            toast.error(err instanceof ClientError ? err.message : "Publish failed");
            throw err;
          }
        }}
      />
    </div>
  );
}

interface SortableRowProps {
  item: FlatItem;
  isActive: boolean;
  isDragging: boolean;
  canEdit: boolean;
  expanded: boolean;
  onToggle: () => void;
  onNavigate: () => void;
  onAction: NodeActionCallbacks;
  slugPath: string;
  isCurrentPath: boolean;
}

function SortableRow({
  item,
  isActive,
  isDragging,
  canEdit,
  expanded,
  onToggle,
  onNavigate,
  onAction,
  slugPath,
  isCurrentPath,
}: SortableRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isOver } = useSortable({ id: item.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const Icon = item.type === "FOLDER" ? Folder : item.type === "LINK" ? Link2 : FileText;

  return (
    <li style={{ paddingLeft: item.depth * indentWidth() }} className="list-none mt-2">
      <div
        ref={setNodeRef}
        style={style}
        {...attributes}
        {...listeners}
        onClick={(e) => {
          e.stopPropagation();
          // Parent rows: from another page → navigate + expand the dropdown;
          // already on their page → toggle only. Leaf rows always navigate.
          if (item.hasChildren) {
            if (isCurrentPath) {
              onToggle();
            } else {
              if (!expanded) onToggle();
              onNavigate();
            }
          } else {
            onNavigate();
          }
        }}
        className={`group/node relative flex cursor-pointer select-none items-center gap-1 rounded-md px-1.5 py-1 mt-4 text-sm ${
          isActive ? "opacity-40" : ""
        } ${isOver ? "ring-1 ring-inset ring-ring" : ""} ${
          isCurrentPath ? "bg-accent font-medium text-accent-foreground" : "text-foreground/80 hover:bg-accent/60"
        } ${item.effectivelyHidden ? "italic opacity-50" : ""}`}
      >
        {isCurrentPath && (
          <span className="absolute left-0 top-1/2 h-3.5 w-[3px] -translate-y-1/2 rounded-r-full bg-gp-green" />
        )}
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate">{item.title}</span>
        {item.hasChildren && (
          // The chevron is part of the row: its clicks bubble to the row handler
          // so the whole row responds identically (navigate + expand / toggle).
          <button
            className="ml-2 flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent"
            aria-label={expanded ? "Collapse" : "Expand"}
          >
            <ChevronRight className={`size-3 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`} />
            <span className="sr-only">{expanded ? "expanded" : "collapsed"}</span>
          </button>
        )}
        {canEdit && (
          <NodeActions
            node={{
              id: item.id,
              parentId: item.parentId,
              type: item.type,
              title: item.title,
              slug: item.slug,
              documentId: item.documentId,
              linkUrl: item.linkUrl,
              icon: null,
              description: null,
              isVisible: item.isVisible,
              sortKey: "",
              deletedAt: null,
              effectivelyHidden: item.effectivelyHidden,
              children: item.hasChildren ? [] : [],
            }}
            slugPath={slugPath}
            canEdit={canEdit}
            onAction={onAction}
          />
        )}
      </div>
      {isDragging && isOver && item.hasChildren && (
        <div className="mx-1 my-0.5 h-0.5 rounded-full bg-primary/60" />
      )}
    </li>
  );
}
