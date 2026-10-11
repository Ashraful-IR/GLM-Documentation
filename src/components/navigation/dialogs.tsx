"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ClientError } from "@/lib/api/client";

export type NodeType = "FOLDER" | "DOCUMENT" | "LINK";

interface MinimalMutations {
  updateNode: (id: string, patch: Record<string, unknown>) => Promise<void>;
  deleteNode: (id: string, permanent?: boolean) => Promise<void>;
}

interface NewItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  parentId: string | null;
  parentTitle: string | null;
  onCreate: (input: { parentId: string | null; type: NodeType; title: string; slug: string; linkUrl?: string | null }) => Promise<void>;
}

export function NewItemDialog({ open, onOpenChange, parentId, parentTitle, onCreate }: NewItemDialogProps) {
  const [type, setType] = useState<NodeType>("DOCUMENT");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Reset fields when the dialog opens; deferred one tick to avoid the
    // synchronous setState-in-effect pattern (react-hooks rule).
    if (!open) return;
    const t = setTimeout(() => {
      setType("DOCUMENT");
      setTitle("");
      setSlug("");
      setLinkUrl("");
      setError(null);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const autoSlug = (value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "item";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const finalSlug = slug.trim() || autoSlug(title);
    if (type === "LINK" && !/^https?:\/\//.test(linkUrl)) {
      setError("Link URL must start with http:// or https://");
      return;
    }
    setSaving(true);
    try {
      await onCreate({
        parentId,
        type,
        title: title.trim(),
        slug: finalSlug,
        linkUrl: type === "LINK" ? linkUrl : null,
      });
      toast.success(`Created ${type.toLowerCase()}`);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ClientError ? err.message : "Failed to create item");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New {type.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {parentId ? <>Inside {parentTitle ?? "this folder"}</> : "At the top level"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <RadioGroup
            value={type}
            onValueChange={(v) => setType(v as NodeType)}
            className="grid grid-cols-3 gap-2"
          >
            {(["FOLDER", "DOCUMENT", "LINK"] as const).map((t) => (
              <Label
                key={t}
                htmlFor={`type-${t}`}
                className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border p-3 text-center text-xs font-medium has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent"
              >
                <RadioGroupItem value={t} id={`type-${t}`} className="sr-only" />
                {t === "FOLDER" ? "Folder" : t === "DOCUMENT" ? "Document" : "Link"}
              </Label>
            ))}
          </RadioGroup>
          <div className="space-y-2">
            <Label htmlFor="new-title">Title</Label>
            <Input
              id="new-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (!slug) setSlug(autoSlug(e.target.value));
              }}
              placeholder={type === "FOLDER" ? "e.g. Architecture" : type === "DOCUMENT" ? "e.g. Getting started" : "e.g. External docs"}
              required
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-slug">Slug</Label>
            <Input id="new-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} placeholder="my-page" required />
          </div>
          {type === "LINK" && (
            <div className="space-y-2">
              <Label htmlFor="new-url">URL</Label>
              <Input id="new-url" type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" required />
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RenameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: { id: string; title: string; slug: string } | null;
  mutations: MinimalMutations;
}

export function RenameDialog({ open, onOpenChange, node, mutations }: RenameDialogProps) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !node) return;
    const t = setTimeout(() => {
      setTitle(node.title);
      setSlug(node.slug);
      setError(null);
    }, 0);
    return () => clearTimeout(t);
  }, [open, node]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!node) return;
    setSaving(true);
    setError(null);
    try {
      await mutations.updateNode(node.id, { title: title.trim(), slug: slug.trim() });
      toast.success("Renamed");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ClientError ? err.message : "Failed to rename");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Rename</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="rename-title">Title</Label>
            <Input id="rename-title" value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="rename-slug">Slug</Label>
            <Input id="rename-slug" value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase())} required />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteNodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: { id: string; title: string; hasChildren: boolean } | null;
  mutations: MinimalMutations;
}

export function DeleteNodeDialog({ open, onOpenChange, node, mutations }: DeleteNodeDialogProps) {
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    if (!node) return;
    setDeleting(true);
    try {
      await mutations.deleteNode(node.id);
      toast.success(node.hasChildren ? "Moved to trash (with contents)" : "Moved to trash");
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Failed to delete");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{node?.title}”?</DialogTitle>
          <DialogDescription>
            {node?.hasChildren
              ? "This will move the item and everything inside it to the trash. You can restore it later."
              : "This moves the item to the trash. You can restore it later."}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={deleting}>
            {deleting ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface HiddenDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: { id: string; title: string } | null;
  mutations: MinimalMutations;
}

export function HideDialog({ open, onOpenChange, node, mutations }: HiddenDialogProps) {
  const [saving, setSaving] = useState(false);
  async function confirm() {
    if (!node) return;
    setSaving(true);
    try {
      await mutations.updateNode(node.id, { isVisible: false });
      toast.success("Hidden from navigation");
      onOpenChange(false);
    } catch {
      toast.error("Failed to hide item");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Hide “{node?.title}”?</DialogTitle>
          <DialogDescription>
            The item (and anything under it) will disappear from the navigation sidebar. Nothing is deleted — show it again from the trash page.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={confirm} disabled={saving}>
            {saving ? "Hiding…" : "Hide"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface PublishDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string | null;
  onPublish: (summary: string | null) => Promise<void>;
}

export function PublishDialog({ open, onOpenChange, documentId, onPublish }: PublishDialogProps) {
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => setSummary(""), 0);
    return () => clearTimeout(t);
  }, [open]);
  async function confirm() {
    if (!documentId) return;
    setSaving(true);
    try {
      await onPublish(summary.trim() || null);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Publish version</DialogTitle>
          <DialogDescription>
            Publishing writes a version snapshot and marks the document as published (§13).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="publish-summary">Change summary (optional)</Label>
          <Textarea
            id="publish-summary"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="e.g. Added the architecture diagrams"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={saving || !documentId} className="gap-1.5">
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {saving ? "Publishing…" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
