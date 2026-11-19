"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { Api, ClientError } from "@/lib/api/client";

export default function SettingsPage() {
  const user = useCurrentUser();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  if (!user) return null;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 sm:px-8 sm:py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>Your display name, role, team and designation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="settings-name">Name</Label>
            <Input
              id="settings-name"
              defaultValue={user.name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input value={user.email} disabled />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Input value={user.role} disabled className="uppercase" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Team</Label>
              <Input value={user.teamName ?? "Not set"} disabled />
            </div>
            <div className="space-y-2">
              <Label>Designation</Label>
              <Input value={user.designationName ?? "Not set"} disabled />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Team and designation are managed by an administrator.</p>
          <Button
            disabled={saving || !name}
            onClick={async () => {
              setSaving(true);
              try {
                await fetch("/api/users/me", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
                toast.success("Profile updated");
              } catch (err) {
                toast.error(err instanceof ClientError ? err.message : "Update failed");
              } finally {
                setSaving(false);
              }
            }}
          >
            {saving ? "Saving…" : "Save profile"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
