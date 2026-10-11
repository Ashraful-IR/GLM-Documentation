"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, Search } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Api } from "@/lib/api/client";
import type { SearchResult } from "@/types";

export function SearchCommand() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  // Monotonic counter so stale search responses are never rendered.
  const searchSeq = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // Reset findings only when the dialog closes (not on open); deferred
    // one tick to avoid synchronous setState-in-effect.
    if (open) return;
    const t = setTimeout(() => {
      setQuery("");
      setResults([]);
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || query.trim().length === 0) {
      // Debounced clear: avoids the synchronous setState-in-effect pattern.
      const timer = setTimeout(() => {
        setResults([]);
        setLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }
    // Debounce: wait until the user pauses typing before firing the request.
    // 400ms absorbs natural human typing pauses, so a single query fires once
    // even when typing with short pauses between keystrokes.
    const timer = setTimeout(() => {
      const seq = ++searchSeq.current;
      setLoading(true);
      void Api.search(query)
        .then((data) => {
          if (seq === searchSeq.current) setResults(data);
        })
        .catch(() => {
          if (seq === searchSeq.current) setResults([]);
        })
        .finally(() => {
          if (seq === searchSeq.current) setLoading(false);
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [query, open]);

  function go(result: SearchResult) {
    setOpen(false);
    router.push(result.url);
  }

  return (
    <>
      <Button
        variant="outline"
        className="w-9 justify-start gap-2 text-muted-foreground sm:w-70 md:w-100"
        onClick={() => setOpen(true)}
        aria-label="Search"
      >
        <Search className="size-3.5 shrink-0" />
        <span className="hidden flex-1 text-left text-sm sm:inline">Search documentation…</span>
        {/* <kbd className="pointer-events-none hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground lg:inline">
          ⌘K
        </kbd> */}
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen}>
        <Command>
          <CommandInput placeholder="Search documents and navigation…" value={query} onValueChange={setQuery} />
          <CommandList>
            {loading && (
              <CommandItem disabled className="gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Searching…
              </CommandItem>
            )}
            {!loading && results.length === 0 && query.trim() && <CommandEmpty>No results for “{query}”</CommandEmpty>}
            {!query.trim() && <CommandEmpty>Type to search titles and content.</CommandEmpty>}
            <CommandGroup heading="Results">
              {results.map((r) => (
                <CommandItem key={`${r.type}-${r.id}`} value={r.title} onSelect={() => go(r)}>
                  <FileText className="size-3.5" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{r.title}</div>
                    {r.excerpt && <div className="truncate text-xs text-muted-foreground">{r.excerpt}</div>}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
