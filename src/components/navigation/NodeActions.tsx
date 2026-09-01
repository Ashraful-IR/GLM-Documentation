"use client";

import {
  Copy,
  ExternalLink,
  EyeOff,
  FilePlus2,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Rocket,
  Trash2,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NavigationNode } from "@/types";

export interface NodeActionCallbacks {
  onAddChild: (node: NavigationNode) => void;
  onRename: (node: NavigationNode) => void;
  onDelete: (node: NavigationNode) => void;
  onHide: (node: NavigationNode) => void;
  onDuplicate: (node: NavigationNode) => void;
  onPublish: (node: NavigationNode) => void;
}

interface NodeActionsProps {
  node: NavigationNode;
  slugPath: string;
  canEdit: boolean;
  onAction: NodeActionCallbacks;
}

export function NodeActions({ node, slugPath, canEdit, onAction }: NodeActionsProps) {
  const router = useRouter();
  const isFolder = node.type === "FOLDER";
  const isLink = node.type === "LINK";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 opacity-0 transition-opacity group-hover/node:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 sm:size-6"
          aria-label={`Actions for ${node.title}`}
          // Stop the click from bubbling to the sidebar row's navigate/toggle handler.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="right" className="w-48">
        {!isFolder && node.documentId && (
          <>
            <DropdownMenuItem
              onClick={() => router.push(`/documentation/${slugPath}`)}
            >
              <ExternalLink className="size-3.5" /> Open
            </DropdownMenuItem>
            {canEdit && (
              <DropdownMenuItem onClick={() => router.push(`/editor/${node.documentId}`)}>
                <Pencil className="size-3.5" /> Edit
              </DropdownMenuItem>
            )}
          </>
        )}
        {isLink && node.linkUrl && (
          <DropdownMenuItem onClick={() => window.open(node.linkUrl!, "_blank")}>
            <ExternalLink className="size-3.5" /> Open link
          </DropdownMenuItem>
        )}
        {canEdit && (
          <>
            <DropdownMenuItem onClick={() => onAction.onAddChild(node)}>
              {isFolder ? <FolderPlus className="size-3.5" /> : <FilePlus2 className="size-3.5" />}
              Add child
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction.onRename(node)}>
              <Pencil className="size-3.5" /> Rename
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onAction.onDuplicate(node)}>
              <Copy className="size-3.5" /> Duplicate
            </DropdownMenuItem>
            {!isFolder && node.documentId && (
              <DropdownMenuItem onClick={() => onAction.onPublish(node)}>
                <Rocket className="size-3.5" /> Publish
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onAction.onHide(node)}>
              <EyeOff className="size-3.5" /> Hide
            </DropdownMenuItem>
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onAction.onDelete(node)}>
              <Trash2 className="size-3.5" /> Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
