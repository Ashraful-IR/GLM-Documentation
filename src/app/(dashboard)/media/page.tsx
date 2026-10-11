"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Api, ClientError } from "@/lib/api/client";

interface MediaRow {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MediaPage() {
  const [items, setItems] = useState<MediaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      setItems(await Api.listMedia());
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Failed to load media");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    // Deferred one tick so the initial load isn't a synchronous
    // setState-in-effect (react-hooks lint rule).
    const t = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(t);
  }, []);

  async function upload(file: File) {
    setUploading(true);
    try {
      const uploaded = await Api.uploadFile(file);
      toast.success(`Uploaded ${uploaded.originalName}`);
      await load();
    } catch (err) {
      toast.error(err instanceof ClientError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const isImage = (mime: string) => mime.startsWith("image/");

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-8 sm:py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Media</h1>
          <p className="mt-1 text-sm text-muted-foreground">Images and files stored locally. Max 20 MB.</p>
        </div>
        <Button onClick={() => inputRef.current?.click()} disabled={uploading} className="gap-1.5">
          <Upload className="size-3.5" /> {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,text/plain,application/zip"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>

      {loading ? (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No files yet. Upload an image to use in your documents.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
          {items.map((item) => (
            <a
              key={item.id}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group overflow-hidden rounded-lg border transition-colors hover:bg-accent/50"
            >
              <div className="flex h-28 items-center justify-center bg-muted/40">
                {isImage(item.mimeType) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.url} alt={item.originalName} className="max-h-full max-w-full object-contain" />
                ) : (
                  <FileText className="size-8 text-muted-foreground" />
                )}
              </div>
              <div className="px-3 py-2">
                <p className="truncate text-xs font-medium">{item.originalName}</p>
                <p className="text-[10px] text-muted-foreground">
                  {item.mimeType} · {formatBytes(item.size)}
                </p>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
