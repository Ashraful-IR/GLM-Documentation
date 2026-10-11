"use client";

import { useEffect, useState } from "react";
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

export type DraftRecoveryChoice = "draft" | "server" | "ignore";

interface DraftRecoveryDialogProps {
  open: boolean;
  kind: "unchanged" | "conflict" | null;
  onChoose: (choice: DraftRecoveryChoice) => void;
}

/**
 * Shown when a localStorage draft exists for a document (§21):
 * - kind "unchanged": server hasn't moved on — offer to restore the draft.
 * - kind "conflict": server updated_at moved on — warn and let the user pick.
 */
export function DraftRecoveryDialog({ open, kind, onChoose }: DraftRecoveryDialogProps) {
  const [resolved, setResolved] = useState(false);
  useEffect(() => {
    // Re-arm asynchronously after mount so the reset isn't a synchronous
    // setState-in-effect (react-hooks lint rule).
    if (!open) return;
    const t = setTimeout(() => setResolved(false), 0);
    return () => clearTimeout(t);
  }, [open]);

  if (!open) return null;

  const conflict = kind === "conflict";

  function choose(choice: DraftRecoveryChoice) {
    setResolved(true);
    onChoose(choice);
    if (choice === "draft") toast.success("Restored your unsaved changes");
    if (choice === "server") toast.info("Using the server version; draft discarded");
  }

  return (
    <Dialog open={open && !resolved} onOpenChange={() => choose("ignore")}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{conflict ? "Draft conflict" : "Unsaved changes found"}</DialogTitle>
          <DialogDescription>
            {conflict ? (
              <>
                A local draft exists, but the server copy has been edited since this draft was
                captured. Choose which version to keep — nothing will be overwritten silently.
              </>
            ) : (
              "You have an unsaved draft of this document. Restore it?"
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" onClick={() => choose("ignore")}>
            Discard draft
          </Button>
          <div className="flex gap-2">
            {conflict && (
              <Button variant="outline" onClick={() => choose("server")}>
                Keep server version
              </Button>
            )}
            <Button onClick={() => choose("draft")}>Restore draft</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
