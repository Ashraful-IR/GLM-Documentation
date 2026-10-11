"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileText,
  Folder,
  Loader2,
  Table as TableIcon,
  Upload,
  UploadCloud,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ClientError } from "@/lib/api/client";
import type {
  ImportCommitItem,
  ImportCommitResult,
  ImportPreviewResponse,
} from "@/lib/import/types";
import type { NavigationNode } from "@/types";

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetNode: NavigationNode | null | "root";
  onSuccess?: (result: ImportCommitResult) => void;
}

type ImportStep = "UPLOAD" | "PREVIEW" | "PROGRESS" | "DONE";

interface EditableItem extends ImportCommitItem {
  method?: string | null;
  route?: string | null;
  contentSummary?: {
    wordCount: number;
    tableCount: number;
    codeBlockCount: number;
  };
}

export function ImportDialog({
  open,
  onOpenChange,
  targetNode,
  onSuccess,
}: ImportDialogProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [step, setStep] = useState<ImportStep>("UPLOAD");
  const [file, setFile] = useState<File | null>(null);
  const [pastedMarkdown, setPastedMarkdown] = useState("");
  const [showPasteArea, setShowPasteArea] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Analysis / Preview State
  const [analyzing, setAnalyzing] = useState(false);
  const [previewData, setPreviewData] = useState<ImportPreviewResponse | null>(null);
  const [folderTitle, setFolderTitle] = useState("");
  const [folderSlug, setFolderSlug] = useState("");
  const [createFolder, setCreateFolder] = useState(true);
  const [autoPublish, setAutoPublish] = useState(true);
  const [items, setItems] = useState<EditableItem[]>([]);
  const [searchFilter, setSearchFilter] = useState("");

  // Progress State
  const [progress, setProgress] = useState(0);
  const [progressStatus, setProgressStatus] = useState("");
  const [importResult, setImportResult] = useState<ImportCommitResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parentId =
    targetNode === "root" || !targetNode
      ? null
      : targetNode.id;
  const parentTitle =
    targetNode === "root" || !targetNode
      ? "Top Level"
      : targetNode.title;

  useEffect(() => {
    // Reset all wizard state when the dialog opens; deferred one tick to
    // avoid the synchronous setState-in-effect pattern (react-hooks rule).
    if (!open) return;
    const t = setTimeout(() => {
      setStep("UPLOAD");
      setFile(null);
      setPastedMarkdown("");
      setShowPasteArea(false);
      setIsDragging(false);
      setAnalyzing(false);
      setPreviewData(null);
      setFolderTitle("");
      setFolderSlug("");
      setCreateFolder(true);
      setAutoPublish(true);
      setItems([]);
      setSearchFilter("");
      setProgress(0);
      setProgressStatus("");
      setImportResult(null);
      setError(null);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile.name.match(/\.(md|markdown|txt)$/i)) {
      setError("Please select a valid markdown file (.md or .markdown)");
      return;
    }
    setFile(selectedFile);
    setError(null);
    void runAnalysis(selectedFile, null);
  };

  const handlePasteSubmit = () => {
    if (!pastedMarkdown.trim()) {
      setError("Please paste markdown content");
      return;
    }
    setError(null);
    void runAnalysis(null, pastedMarkdown);
  };

  async function runAnalysis(fileToAnalyze: File | null, rawText: string | null) {
    setAnalyzing(true);
    setError(null);
    try {
      let res: Response;
      if (fileToAnalyze) {
        const formData = new FormData();
        formData.append("file", fileToAnalyze);
        if (parentId) formData.append("parentId", parentId);
        res = await fetch("/api/import/analyze", {
          method: "POST",
          body: formData,
        });
      } else {
        res = await fetch("/api/import/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rawMarkdown: rawText,
            filename: "Pasted-Documentation.md",
            parentId,
          }),
        });
      }

      const body = await res.json();
      if (!body.success) {
        throw new ClientError(body.error?.code || "ANALYSIS_FAILED", body.error?.message || "Failed to analyze markdown", res.status);
      }

      const preview = body.data as ImportPreviewResponse;
      setPreviewData(preview);
      setFolderTitle(preview.suggestedFolderTitle);
      setFolderSlug(preview.suggestedFolderSlug);

      // Combine catalog and reference sections
      const combined: EditableItem[] = [
        ...preview.sections.map((s) => ({
          id: s.id,
          title: s.title,
          slug: s.slug,
          type: s.type,
          method: s.method,
          route: s.route,
          rawMarkdown: s.rawMarkdown,
          orderIndex: s.orderIndex,
          include: true,
          contentSummary: s.contentSummary,
        })),
        ...preview.referenceSections.map((s, idx) => ({
          id: s.id,
          title: s.title,
          slug: s.slug,
          type: s.type,
          method: s.method,
          route: s.route,
          rawMarkdown: s.rawMarkdown,
          orderIndex: preview.sections.length + idx,
          include: true,
          contentSummary: s.contentSummary,
        })),
      ];

      setItems(combined);
      setStep("PREVIEW");
    } catch (err) {
      setError(err instanceof ClientError ? err.message : "Failed to parse markdown file");
    } finally {
      setAnalyzing(false);
    }
  }

  const toggleSelectAll = (checked: boolean) => {
    setItems((prev) => prev.map((item) => ({ ...item, include: checked })));
  };

  const updateItem = (index: number, patch: Partial<EditableItem>) => {
    setItems((prev) => {
      const copy = [...prev];
      copy[index] = { ...copy[index], ...patch };
      return copy;
    });
  };

  async function handleCommit() {
    const includedItems = items.filter((i) => i.include);
    if (includedItems.length === 0) {
      setError("Please select at least one document to import");
      return;
    }

    setStep("PROGRESS");
    setError(null);
    setProgress(15);
    setProgressStatus("Preparing import payload & AST mappings...");

    try {
      const payload = {
        sourceFilename: file?.name || "Imported-Document.md",
        rawMarkdown: previewData?.sections?.[0]?.rawMarkdown || "",
        strategyUsed: previewData?.strategy || "PatternHeadingStrategy",
        parentId,
        createFolder,
        folderTitle: folderTitle.trim() || "Imported Documentation",
        folderSlug: folderSlug.trim() || "imported-documentation",
        autoPublish,
        items: includedItems.map((item, idx) => ({
          title: item.title.trim(),
          slug: item.slug.trim(),
          type: item.type,
          rawMarkdown: item.rawMarkdown,
          orderIndex: idx,
          include: true,
        })),
      };

      setProgress(40);
      setProgressStatus(
        autoPublish
          ? `Creating & auto-publishing ${includedItems.length} documents...`
          : `Creating ${includedItems.length} draft documents...`
      );

      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      setProgress(85);
      setProgressStatus("Finalizing navigation tree & audit logs...");

      const body = await res.json();
      if (!body.success) {
        throw new ClientError(body.error?.code || "COMMIT_FAILED", body.error?.message || "Failed to commit import", res.status);
      }

      const result = body.data as ImportCommitResult;
      setProgress(100);
      setProgressStatus("Import and publishing completed!");
      setImportResult(result);
      setStep("DONE");

      toast.success(
        autoPublish
          ? `Successfully imported and published ${result.createdCount} documents!`
          : `Successfully imported ${result.createdCount} draft documents!`
      );

      if (onSuccess) {
        onSuccess(result);
      }
    } catch (err) {
      setError(err instanceof ClientError ? err.message : "Import failed");
      setStep("PREVIEW");
    }
  }

  const filteredItems = items.filter(
    (item) =>
      item.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
      item.slug.toLowerCase().includes(searchFilter.toLowerCase()) ||
      (item.route && item.route.toLowerCase().includes(searchFilter.toLowerCase()))
  );

  const includedCount = items.filter((i) => i.include).length;

  const getMethodBadgeClass = (method?: string | null) => {
    switch (method?.toUpperCase()) {
      case "GET":
        return "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30";
      case "POST":
        return "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
      case "PUT":
      case "PATCH":
        return "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30";
      case "DELETE":
        return "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={step === "PREVIEW" ? "sm:max-w-3xl max-h-[90vh] flex flex-col" : "sm:max-w-lg"}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="size-5 text-primary" />
            Import Markdown Documentation
          </DialogTitle>
          <DialogDescription>
            {targetNode === "root" || !targetNode ? (
              <span>Importing at the top level</span>
            ) : (
              <span>
                Target destination: <strong>{parentTitle}</strong>
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertCircle className="size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* STEP 1: UPLOAD */}
        {step === "UPLOAD" && (
          <div className="space-y-4 py-2">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                const droppedFile = e.dataTransfer.files[0];
                if (droppedFile) handleFileSelect(droppedFile);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-all ${
                isDragging
                  ? "border-primary bg-primary/5 scale-[0.99]"
                  : "border-border hover:border-primary/50 hover:bg-accent/40"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.txt"
                className="hidden"
                onChange={(e) => {
                  const selected = e.target.files?.[0];
                  if (selected) handleFileSelect(selected);
                }}
              />
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Upload className="size-6" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  Click to browse or drag and drop your markdown file
                </p>
                <p className="text-xs text-muted-foreground">
                  Supports .md, .markdown up to 10MB
                </p>
              </div>
            </div>

            {analyzing && (
              <div className="flex items-center justify-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin text-primary" />
                Analyzing sections and endpoints...
              </div>
            )}

            {/* Collapsible raw text paste option */}
            <div className="border-t pt-3">
              <button
                type="button"
                onClick={() => setShowPasteArea(!showPasteArea)}
                className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showPasteArea ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                Or paste raw markdown directly
              </button>
              {showPasteArea && (
                <div className="mt-2 space-y-2">
                  <Textarea
                    placeholder="Paste markdown content here..."
                    rows={5}
                    value={pastedMarkdown}
                    onChange={(e) => setPastedMarkdown(e.target.value)}
                    className="font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handlePasteSubmit}
                    disabled={analyzing || !pastedMarkdown.trim()}
                    className="w-full"
                  >
                    {analyzing ? (
                      <>
                        <Loader2 className="mr-2 size-3.5 animate-spin" />
                        Analyzing...
                      </>
                    ) : (
                      "Analyze Pasted Markdown"
                    )}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 2: PREVIEW MATRIX */}
        {step === "PREVIEW" && (
          <div className="flex min-h-0 flex-1 flex-col space-y-3.5 py-1">
            {/* Top configuration panel */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 rounded-lg border bg-muted/40 p-3 shrink-0">
              <div className="space-y-1.5">
                <Label htmlFor="folder-title" className="text-xs font-medium">
                  Parent Folder Title
                </Label>
                <Input
                  id="folder-title"
                  value={folderTitle}
                  onChange={(e) => setFolderTitle(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Folder Name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="folder-slug" className="text-xs font-medium">
                  Folder Slug
                </Label>
                <Input
                  id="folder-slug"
                  value={folderSlug}
                  onChange={(e) => setFolderSlug(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="folder-slug"
                />
              </div>
              <div className="flex items-center space-x-2 pt-1 sm:col-span-2">
                <Checkbox
                  id="auto-publish-toggle"
                  checked={autoPublish}
                  onCheckedChange={(c) => setAutoPublish(!!c)}
                />
                <label
                  htmlFor="auto-publish-toggle"
                  className="cursor-pointer text-xs font-medium leading-none text-foreground"
                >
                  Auto-publish imported documents immediately (creates Version 1)
                </label>
              </div>
            </div>

            {/* Filter and stats */}
            <div className="flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="font-normal text-xs">
                  Strategy: {previewData?.strategy}
                </Badge>
                <span>
                  {includedCount} of {items.length} selected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  placeholder="Filter sections..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="h-7 w-40 text-xs"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => toggleSelectAll(includedCount !== items.length)}
                >
                  {includedCount === items.length ? "Deselect All" : "Select All"}
                </Button>
              </div>
            </div>

            {/* Scrollable Items Table */}
            <div className="min-h-0 flex-1 max-h-[380px] overflow-y-auto rounded-md border bg-background">
              <div className="divide-y divide-border">
                {filteredItems.map((item, idx) => {
                  const originalIndex = items.findIndex((i) => i.id === item.id);
                  return (
                    <div
                      key={item.id || idx}
                      className={`flex items-center gap-2.5 p-2.5 transition-colors ${
                        item.include ? "bg-background" : "bg-muted/30 opacity-60"
                      }`}
                    >
                      <Checkbox
                        checked={item.include}
                        onCheckedChange={(c) =>
                          updateItem(originalIndex, { include: !!c })
                        }
                        className="size-4 shrink-0"
                      />

                      {item.method ? (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold border ${getMethodBadgeClass(
                            item.method
                          )}`}
                        >
                          {item.method}
                        </span>
                      ) : (
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {item.type === "REFERENCE" ? "REF" : "DOC"}
                        </span>
                      )}

                      <div className="grid flex-1 grid-cols-1 sm:grid-cols-2 gap-2">
                        <Input
                          value={item.title}
                          onChange={(e) =>
                            updateItem(originalIndex, { title: e.target.value })
                          }
                          className="h-7 text-xs"
                          placeholder="Document title"
                        />
                        <Input
                          value={item.slug}
                          onChange={(e) =>
                            updateItem(originalIndex, { slug: e.target.value })
                          }
                          className="h-7 text-xs font-mono text-muted-foreground"
                          placeholder="document-slug"
                        />
                      </div>

                      {item.contentSummary && (
                        <div className="hidden sm:flex items-center gap-2 shrink-0 text-[11px] text-muted-foreground">
                          {item.contentSummary.tableCount > 0 && (
                            <span className="flex items-center gap-0.5" title="Tables">
                              <TableIcon className="size-3" />
                              {item.contentSummary.tableCount}
                            </span>
                          )}
                          {item.contentSummary.codeBlockCount > 0 && (
                            <span className="flex items-center gap-0.5" title="Code blocks">
                              <FileCode2 className="size-3" />
                              {item.contentSummary.codeBlockCount}
                            </span>
                          )}
                          <span>{item.contentSummary.wordCount}w</span>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: PROGRESS BAR */}
        {step === "PROGRESS" && (
          <div className="space-y-6 py-8 text-center">
            <div className="flex justify-center">
              <div className="relative flex size-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Loader2 className="size-8 animate-spin" />
              </div>
            </div>
            <div className="space-y-2">
              <h3 className="text-base font-semibold">Importing Documentation</h3>
              <p className="text-xs text-muted-foreground">{progressStatus}</p>
            </div>
            <div className="space-y-1.5 px-4">
              <Progress value={progress} className="h-2.5 w-full" />
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: DONE */}
        {step === "DONE" && (
          <div className="space-y-5 py-6 text-center">
            <div className="flex justify-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="size-8" />
              </div>
            </div>
            <div className="space-y-1.5">
              <h3 className="text-base font-semibold">Import Complete!</h3>
              <p className="text-xs text-muted-foreground">
                {importResult?.createdCount} document
                {(importResult?.createdCount ?? 0) > 1 ? "s" : ""} imported and{" "}
                {importResult?.autoPublished ? "published" : "created as drafts"}{" "}
                under <strong>{folderTitle}</strong>.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={() => {
                onOpenChange(false);
                if (importResult?.firstDocumentSlugPath) {
                  router.push(`/documentation/${importResult.firstDocumentSlugPath}`);
                }
                router.refresh();
              }}
            >
              View Documentation
            </Button>
          </div>
        )}

        {/* FOOTER CONTROLS */}
        {step === "PREVIEW" && (
          <DialogFooter className="flex items-center justify-between border-t pt-3 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStep("UPLOAD")}
            >
              Back
            </Button>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleCommit}
                disabled={includedCount === 0}
              >
                Confirm & Import ({includedCount})
              </Button>
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
