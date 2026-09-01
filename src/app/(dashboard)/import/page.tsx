"use client";

import { useCallback, useRef, useState } from "react";
import {
  Upload,
  FileText,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  AlertTriangle,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { ClientError } from "@/lib/api/client";

// ── Types ───────────────────────────────────────────────────────────────

interface PreviewItem {
  matchKey: string;
  title: string;
  slugHint: string;
  orderIndex: number;
  excluded: boolean;
  existingItemId: string | null;
  conflict: boolean;
}

interface PreviewResult {
  jobId: string;
  filename: string;
  strategy: string;
  parentFolderTitle: string;
  items: PreviewItem[];
  referenceItems: PreviewItem[];
  warnings: string[];
}

interface CommitResult {
  jobId: string;
  folderId: string;
  created: number;
  skipped: number;
  warnings: string[];
}

type Step = "upload" | "preview" | "result";

// ── Component ───────────────────────────────────────────────────────────

export default function ImportPage() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [loading, setLoading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [items, setItems] = useState<PreviewItem[]>([]);
  const [referenceItems, setReferenceItems] = useState<PreviewItem[]>([]);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [expandedRefs, setExpandedRefs] = useState(true);

  // ── Upload handler ──────────────────────────────────────────────

  const handleAnalyze = useCallback(async () => {
    if (!file) return;
    setLoading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/import/analyze", {
        method: "POST",
        body: formData,
      });
      const body = await res.json();
      if (!body.success) {
        throw new ClientError(body.error.code, body.error.message, res.status);
      }

      const data: PreviewResult = body.data;
      setPreview(data);
      setItems(data.items.map((i) => ({ ...i })));
      setReferenceItems(data.referenceItems.map((i) => ({ ...i })));
      setStep("preview");
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Analysis failed");
    } finally {
      setLoading(false);
    }
  }, [file]);

  // ── Commit handler ─────────────────────────────────────────────

  const handleCommit = useCallback(async () => {
    if (!preview) return;
    setLoading(true);
    try {
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId: preview.jobId,
          items,
          referenceItems,
        }),
      });
      const body = await res.json();
      if (!body.success) {
        throw new ClientError(body.error.code, body.error.message, res.status);
      }

      const result: CommitResult = body.data;
      setCommitResult(result);
      setStep("result");
      toast.success(`Imported ${result.created} documents`);
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }, [preview, items, referenceItems]);

  // ── Toggle exclude ────────────────────────────────────────────

  function toggleItem(matchKey: string, kind: "item" | "ref") {
    if (kind === "ref") {
      setReferenceItems((prev) =>
        prev.map((i) => (i.matchKey === matchKey ? { ...i, excluded: !i.excluded } : i)),
      );
    } else {
      setItems((prev) =>
        prev.map((i) => (i.matchKey === matchKey ? { ...i, excluded: !i.excluded } : i)),
      );
    }
  }

  function editItemTitle(matchKey: string, newTitle: string, kind: "item" | "ref") {
    if (kind === "ref") {
      setReferenceItems((prev) =>
        prev.map((i) => (i.matchKey === matchKey ? { ...i, title: newTitle } : i)),
      );
    } else {
      setItems((prev) =>
        prev.map((i) => (i.matchKey === matchKey ? { ...i, title: newTitle } : i)),
      );
    }
  }

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-8 sm:py-14">
      <h1 className="text-2xl font-bold tracking-tight">Import Markdown</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Upload a Markdown file to auto-split it into individual documents.
      </p>

      {/* Step 1: Upload */}
      {step === "upload" && (
        <div className="mt-8">
          <div
            className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-12 text-center transition-colors hover:border-primary/40 hover:bg-accent/20"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const dropped = e.dataTransfer.files[0];
              if (dropped?.name.endsWith(".md")) {
                setFile(dropped);
              } else {
                toast.error("Please upload a .md file");
              }
            }}
          >
            <Upload className="mb-4 size-10 text-muted-foreground" />
            {file ? (
              <>
                <p className="font-medium">{file.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">Click to upload or drag and drop</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Markdown files (.md) up to 5 MB
                </p>
              </>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".md"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) setFile(f);
            }}
          />
          <Button
            className="mt-6 w-full"
            onClick={handleAnalyze}
            disabled={!file || loading}
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Analyzing…
              </>
            ) : (
              <>
                <FileText className="mr-2 size-4" />
                Analyze &amp; Preview
              </>
            )}
          </Button>
        </div>
      )}

      {/* Step 2: Preview */}
      {step === "preview" && preview && (
        <div className="mt-8">
          <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4">
            <FolderOpen className="size-5 text-muted-foreground" />
            <div>
              <p className="font-medium">{preview.parentFolderTitle}</p>
              <p className="text-xs text-muted-foreground">
                Strategy: {preview.strategy} · {items.length + referenceItems.length} sections detected
              </p>
            </div>
          </div>

          {preview.warnings.length > 0 && (
            <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              {preview.warnings.map((w, i) => (
                <p key={i} className="flex items-start gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* Sections list */}
          <div className="mt-6 space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Document Sections ({items.length})
            </h3>
            {items.map((item) => (
              <div
                key={item.matchKey}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                  item.excluded ? "opacity-40" : "bg-background"
                }`}
              >
                <button
                  onClick={() => toggleItem(item.matchKey, "item")}
                  className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors ${
                    item.excluded
                      ? "border-muted bg-muted"
                      : "border-primary bg-primary text-primary-foreground"
                  }`}
                >
                  {item.excluded ? <X className="size-3" /> : <Check className="size-3" />}
                </button>
                <input
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  value={item.title}
                  onChange={(e) => editItemTitle(item.matchKey, e.target.value, "item")}
                  disabled={item.excluded}
                />
              </div>
            ))}
          </div>

          {/* Reference sections */}
          {referenceItems.length > 0 && (
            <div className="mt-6 space-y-1">
              <button
                onClick={() => setExpandedRefs((v) => !v)}
                className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground"
              >
                {expandedRefs ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                Reference Sections ({referenceItems.length})
              </button>
              {expandedRefs && (
                <>
                  {referenceItems.map((item) => (
                    <div
                      key={item.matchKey}
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 transition-colors ${
                        item.excluded ? "opacity-40" : "bg-background"
                      }`}
                    >
                      <button
                        onClick={() => toggleItem(item.matchKey, "ref")}
                        className={`flex size-5 shrink-0 items-center justify-center rounded border transition-colors ${
                          item.excluded
                            ? "border-muted bg-muted"
                            : "border-primary bg-primary text-primary-foreground"
                        }`}
                      >
                        {item.excluded ? (
                          <X className="size-3" />
                        ) : (
                          <Check className="size-3" />
                        )}
                      </button>
                      <input
                        className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                        value={item.title}
                        onChange={(e) =>
                          editItemTitle(item.matchKey, e.target.value, "ref")
                        }
                        disabled={item.excluded}
                      />
                    </div>
                  ))}
                </>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-8 flex gap-3">
            <Button variant="outline" onClick={() => setStep("upload")}>
              Back
            </Button>
            <Button className="flex-1" onClick={handleCommit} disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Committing…
                </>
              ) : (
                <>
                  <Check className="mr-2 size-4" />
                  Commit Import ({items.filter((i) => !i.excluded).length} documents)
                </>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Step 3: Result */}
      {step === "result" && commitResult && (
        <div className="mt-8 space-y-6">
          <div className="rounded-xl border bg-muted/30 p-6 text-center">
            <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
              <Check className="size-6 text-primary" />
            </div>
            <h2 className="mt-4 text-lg font-semibold">Import Complete</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Created {commitResult.created} document(s) in draft status.
              {commitResult.skipped > 0 && ` Skipped ${commitResult.skipped}.`}
            </p>
          </div>

          {commitResult.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-600">
                Warnings
              </p>
              {commitResult.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-600 dark:text-amber-400">
                  {w}
                </p>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" onClick={() => { setStep("upload"); setFile(null); setPreview(null); setCommitResult(null); }}>
              Import Another
            </Button>
            <Button
              className="flex-1"
              onClick={() => router.push("/documentation")}
            >
              Browse Documentation
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
