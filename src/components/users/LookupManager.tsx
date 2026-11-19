"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Api, ClientError } from "@/lib/api/client";
import type { LookupItem, LookupKind } from "@/types";

/** Add / rename / delete one admin-managed list (teams or designations). */
export function LookupManager({
  kind,
  title,
  items,
  onChanged,
}: {
  kind: LookupKind;
  title: string;
  items: LookupItem[];
  onChanged: () => void;
}) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      onChanged();
      return true;
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Something went wrong");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    if (await run(() => Api.createLookup(kind, name), `Added "${name}"`)) setNewName("");
  }

  async function rename(id: string) {
    const name = editName.trim();
    if (!name) return;
    if (await run(() => Api.renameLookup(kind, id, name), `Renamed to "${name}"`)) setEditingId(null);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Shown as a dropdown on the registration form.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={add} className="flex gap-2">
          <Input
            placeholder={`New ${kind}`}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            aria-label={`New ${kind} name`}
          />
          <Button type="submit" size="icon" disabled={busy || !newName.trim()} aria-label={`Add ${kind}`}>
            <Plus className="size-4" />
          </Button>
        </form>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet. Users can&apos;t register until at least one exists.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2 px-3 py-2">
                {editingId === item.id ? (
                  <>
                    <Input
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void rename(item.id);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                      className="h-8"
                      aria-label={`Rename ${item.name}`}
                    />
                    <Button size="icon" variant="ghost" className="size-8" disabled={busy} onClick={() => void rename(item.id)} aria-label="Save name">
                      <Check className="size-4" />
                    </Button>
                    <Button size="icon" variant="ghost" className="size-8" onClick={() => setEditingId(null)} aria-label="Cancel rename">
                      <X className="size-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {item.userCount ?? 0} {item.userCount === 1 ? "user" : "users"}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      onClick={() => {
                        setEditingId(item.id);
                        setEditName(item.name);
                      }}
                      aria-label={`Rename ${item.name}`}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8 text-destructive"
                      disabled={busy}
                      onClick={() => void run(() => Api.deleteLookup(kind, item.id), `Deleted "${item.name}"`)}
                      aria-label={`Delete ${item.name}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
