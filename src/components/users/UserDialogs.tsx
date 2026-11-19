"use client";

import { useState } from "react";
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
import { PasswordInput } from "@/components/ui/password-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Api, ClientError } from "@/lib/api/client";
import type { AdminUserRow, LookupItem, UserRole } from "@/types";

interface LookupProps {
  teams: LookupItem[];
  designations: LookupItem[];
}

function LookupSelect({
  id,
  label,
  items,
  value,
  onChange,
}: {
  id: string;
  label: string;
  items: LookupItem[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder={items.length ? `Select ${label.toLowerCase()}` : `No ${label.toLowerCase()}s yet`} />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Admin creates an account directly. It is active immediately. */
export function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
  teams,
  designations,
}: LookupProps & { open: boolean; onOpenChange: (o: boolean) => void; onCreated: () => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Form state lives in a child that unmounts on close, so every open starts blank. */}
        <CreateUserForm
          teams={teams}
          designations={designations}
          onCancel={() => onOpenChange(false)}
          onCreated={() => {
            onOpenChange(false);
            onCreated();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CreateUserForm({
  teams,
  designations,
  onCancel,
  onCreated,
}: LookupProps & { onCancel: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("VIEWER");
  const [teamId, setTeamId] = useState("");
  const [designationId, setDesignationId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Password must be at least 8 characters");
    if (!teamId || !designationId) return setError("Select a team and a designation");
    setSaving(true);
    try {
      await Api.createUser({ name, email, password, role, teamId, designationId });
      toast.success(`Created ${name}`);
      onCreated();
    } catch (err) {
      setError(err instanceof ClientError ? err.message : "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>Create user</DialogTitle>
        <DialogDescription>
          The account is active immediately. Share the initial password with the user; they can sign in right away.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-2">
        <Label htmlFor="cu-name">Name</Label>
        <Input id="cu-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cu-email">Email</Label>
        <Input id="cu-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <LookupSelect id="cu-team" label="Team" items={teams} value={teamId} onChange={setTeamId} />
        <LookupSelect id="cu-designation" label="Designation" items={designations} value={designationId} onChange={setDesignationId} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="cu-role">Role</Label>
        <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
          <SelectTrigger id="cu-role" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ADMIN">Admin</SelectItem>
            <SelectItem value="EDITOR">Editor</SelectItem>
            <SelectItem value="VIEWER">Viewer</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="cu-password">Initial password</Label>
        <PasswordInput
          id="cu-password"
          autoComplete="new-password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? "Creating…" : "Create user"}</Button>
      </DialogFooter>
    </form>
  );
}

/** Admin edits a user's team / designation (e.g. to fill in pre-existing users). */
export function EditProfileDialog({
  user,
  onOpenChange,
  onSaved,
  teams,
  designations,
}: LookupProps & { user: AdminUserRow | null; onOpenChange: (o: boolean) => void; onSaved: () => void }) {
  return (
    <Dialog open={user !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {user && (
          <EditProfileForm
            key={user.id}
            user={user}
            teams={teams}
            designations={designations}
            onCancel={() => onOpenChange(false)}
            onSaved={() => {
              onOpenChange(false);
              onSaved();
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditProfileForm({
  user,
  teams,
  designations,
  onCancel,
  onSaved,
}: LookupProps & { user: AdminUserRow; onCancel: () => void; onSaved: () => void }) {
  const [teamId, setTeamId] = useState(user.teamId ?? "");
  const [designationId, setDesignationId] = useState(user.designationId ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await Api.updateUserProfile(user.id, {
        ...(teamId ? { teamId } : {}),
        ...(designationId ? { designationId } : {}),
      });
      toast.success(`Updated ${user.name}`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Failed to update user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {user.name}</DialogTitle>
        <DialogDescription>{user.email}</DialogDescription>
      </DialogHeader>
      <div className="grid gap-4 sm:grid-cols-2">
        <LookupSelect id="ep-team" label="Team" items={teams} value={teamId} onChange={setTeamId} />
        <LookupSelect id="ep-designation" label="Designation" items={designations} value={designationId} onChange={setDesignationId} />
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button onClick={() => void save()} disabled={saving || (!teamId && !designationId)}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </>
  );
}
