"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LookupManager } from "@/components/users/LookupManager";
import { CreateUserDialog, EditProfileDialog } from "@/components/users/UserDialogs";
import { Api, ClientError } from "@/lib/api/client";
import type { AdminUserRow, LookupItem } from "@/types";

function initials(name: string) {
  return name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function errMsg(err: unknown, fallback: string) {
  return err instanceof ClientError ? err.message : fallback;
}

function UserIdentity({ u }: { u: AdminUserRow }) {
  const profile = [u.designationName, u.teamName].filter(Boolean).join(" · ");
  return (
    <>
      <Avatar className="size-8 shrink-0">
        <AvatarFallback className="text-[10px]">{initials(u.name)}</AvatarFallback>
      </Avatar>
      {/* min width lets the row's controls wrap to their own line on narrow screens */}
      <div className="min-w-40 flex-1">
        <p className="truncate text-sm font-medium">{u.name}</p>
        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
        <p className="truncate text-xs text-muted-foreground">
          {profile || <span className="italic">No team or designation</span>}
        </p>
      </div>
    </>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [teams, setTeams] = useState<LookupItem[]>([]);
  const [designations, setDesignations] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [rejecting, setRejecting] = useState<AdminUserRow | null>(null);

  const loadUsers = useCallback(
    () => Api.listUsers().then(setUsers).catch((err) => toast.error(errMsg(err, "Failed to load users"))),
    [],
  );
  const loadLookups = useCallback(
    () =>
      Promise.all([Api.listLookup("team"), Api.listLookup("designation")])
        .then(([t, d]) => {
          setTeams(t);
          setDesignations(d);
        })
        .catch((err) => toast.error(errMsg(err, "Failed to load teams and designations"))),
    [],
  );

  useEffect(() => {
    void Promise.all([loadUsers(), loadLookups()]).finally(() => setLoading(false));
  }, [loadUsers, loadLookups]);

  const pending = useMemo(() => users.filter((u) => u.status === "PENDING"), [users]);
  const others = useMemo(() => users.filter((u) => u.status !== "PENDING"), [users]);

  async function changeRole(userId: string, role: AdminUserRow["role"]) {
    try {
      const updated = await Api.updateUserRole(userId, role);
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: updated.role } : u)));
      toast.success(`Role updated to ${role}`);
    } catch (err) {
      toast.error(errMsg(err, "Failed to update role"));
    }
  }

  async function setStatus(u: AdminUserRow, status: "ACTIVE" | "REJECTED") {
    try {
      await Api.setUserStatus(u.id, status);
      toast.success(status === "ACTIVE" ? `Approved ${u.name}` : `Rejected ${u.name}`);
      await loadUsers();
    } catch (err) {
      toast.error(errMsg(err, "Failed to update account"));
    }
  }

  // Lookup changes alter user counts and names shown in the user list.
  const onLookupChanged = () => void Promise.all([loadLookups(), loadUsers()]);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Approve registrations, create accounts and manage roles.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="size-4" />
          Create user
        </Button>
      </div>

      <Tabs defaultValue="users" className="mt-6">
        <TabsList>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="pending">
            Pending
            {pending.length > 0 && (
              <Badge className="ml-1.5 h-5 min-w-5 px-1.5 text-[10px]">{pending.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="lists">Teams &amp; designations</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4 space-y-2">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            others.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <UserIdentity u={u} />
                <div className="flex items-center gap-2">
                  {u.status === "REJECTED" && (
                    <Badge variant="destructive" className="text-[10px]">Rejected</Badge>
                  )}
                  <Select value={u.role} onValueChange={(v) => void changeRole(u.id, v as AdminUserRow["role"])}>
                    <SelectTrigger className="w-28 sm:w-32" aria-label={`Role for ${u.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ADMIN">Admin</SelectItem>
                      <SelectItem value="EDITOR">Editor</SelectItem>
                      <SelectItem value="VIEWER">Viewer</SelectItem>
                    </SelectContent>
                  </Select>
                  {u.status === "REJECTED" ? (
                    <Button size="sm" variant="outline" onClick={() => void setStatus(u, "ACTIVE")}>Approve</Button>
                  ) : (
                    <Button size="icon" variant="ghost" onClick={() => setEditing(u)} aria-label={`Edit ${u.name}`}>
                      <Pencil className="size-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          )}
          <p className="pt-2 text-xs text-muted-foreground">
            Editors can write and publish; viewers can only read. You cannot remove your own admin role.
          </p>
        </TabsContent>

        <TabsContent value="pending" className="mt-4 space-y-2">
          {loading ? (
            <Skeleton className="h-16 w-full" />
          ) : pending.length === 0 ? (
            <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground">No registrations waiting for approval.</p>
          ) : (
            pending.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <UserIdentity u={u} />
                <span className="text-xs text-muted-foreground">
                  {new Date(u.createdAt).toLocaleDateString()}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setRejecting(u)}>
                    <X className="size-4" />
                    Reject
                  </Button>
                  <Button size="sm" onClick={() => void setStatus(u, "ACTIVE")}>
                    <Check className="size-4" />
                    Approve
                  </Button>
                </div>
              </div>
            ))
          )}
          <p className="pt-2 text-xs text-muted-foreground">Approved users join as Viewers; change their role on the Users tab.</p>
        </TabsContent>

        <TabsContent value="lists" className="mt-4 grid gap-4 md:grid-cols-2">
          <LookupManager kind="team" title="Teams" items={teams} onChanged={onLookupChanged} />
          <LookupManager kind="designation" title="Designations" items={designations} onChanged={onLookupChanged} />
        </TabsContent>
      </Tabs>

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={onLookupChanged}
        teams={teams}
        designations={designations}
      />
      <EditProfileDialog
        user={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={onLookupChanged}
        teams={teams}
        designations={designations}
      />
      <AlertDialog open={rejecting !== null} onOpenChange={(o) => !o && setRejecting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject {rejecting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              They won&apos;t be able to sign in. You can still approve them later from the Users tab.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rejecting) void setStatus(rejecting, "REJECTED");
                setRejecting(null);
              }}
            >
              Reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
