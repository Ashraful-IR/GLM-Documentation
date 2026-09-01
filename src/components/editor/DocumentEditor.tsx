"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { buildEditorExtensions, documentBodyClass } from "./editor-config";
import { EditorToolbar } from "./EditorToolbar";
import { EditorBubbleMenu } from "./BubbleMenu";
import { SlashCommand } from "./SlashCommand";
import { DraftRecoveryDialog, type DraftRecoveryChoice } from "./DraftRecoveryDialog";
import { STORAGE_KEYS, getItem, setItem, removeItem, type EditorDraft } from "@/lib/storage/local-storage";
import { Api, ClientError } from "@/lib/api/client";
import type { SaveStatus as Status } from "@/types";
import type { TiptapDocument } from "@/types/editor";

const AUTOSAVE_DEBOUNCE_MS = 1200;
const DRAFT_DEBOUNCE_MS = 400;

/** Fixed paper width (A4-ish on screen). Scaled by the zoom control. */
const PAPER_WIDTH = 820;

/**
 * Imperative handle the surrounding workspace uses to force-save pending
 * edits before publishing/checkpointing. Resolves with the flushed snapshot,
 * or null when the save failed (an error toast is already shown).
 */
export interface EditorApi {
  flush: () => Promise<{ title: string; content: TiptapDocument } | null>;
}

export interface DocumentEditorProps {
  documentId: string;
  initialTitle: string;
  initialContent: TiptapDocument;
  serverUpdatedAt: string;
  canEdit: boolean;
  onTitleChange?: (title: string) => void;
  /** Fired whenever the working copy changes (so the workspace can flag unpublished edits). */
  onEditorChanged?: () => void;
  /** Filled with the editor's imperative API once mounted. */
  apiRef?: React.MutableRefObject<EditorApi | null>;
}

export function DocumentEditor({
  documentId,
  initialTitle,
  initialContent,
  serverUpdatedAt,
  canEdit,
  onTitleChange,
  onEditorChanged,
  apiRef,
}: DocumentEditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [status, setStatus] = useState<Status>("idle");
  const [draftPrompt, setDraftPrompt] = useState<{ kind: "unchanged" | "conflict" } | null>(null);
  const [zoom, setZoom] = useState(100);
  const [pageHeight, setPageHeight] = useState(0);
  const [viewportWidth, setViewportWidth] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);

  const draftKey = STORAGE_KEYS.editorDraft(documentId);
  const positionKey = STORAGE_KEYS.editorLastPosition(documentId);

  const dirtyRef = useRef(false);
  const statusRef = useRef<Status>("idle");
  const contentRef = useRef<TiptapDocument>(initialContent);
  const titleRef = useRef(initialTitle);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedUpdatedAtRef = useRef(serverUpdatedAt);
  // Set while a restored draft is being pushed to the server; on success the
  // localStorage draft is removed so the recovery dialog can't re-appear.
  const draftRestoredRef = useRef(false);

  const setStatusSafe = (s: Status) => {
    statusRef.current = s;
    setStatus(s);
  };

  const persistDraft = useCallback(
    (content: TiptapDocument, t: string) => {
      if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
      draftTimerRef.current = setTimeout(() => {
        setItem<EditorDraft>(draftKey, {
          content,
          title: t,
          savedServerUpdatedAt: savedUpdatedAtRef.current,
          savedAt: Date.now(),
        });
      }, DRAFT_DEBOUNCE_MS);
    },
    [draftKey],
  );

  /**
   * Force-save the latest edits from the refs (clearing any pending timers).
   * Used by autosave and by the workspace before publish/checkpoint.
   */
  const flush = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    const snapshot = { title: titleRef.current, content: contentRef.current };
    if (!dirtyRef.current) return snapshot;
    dirtyRef.current = false;
    setStatusSafe("saving");
    try {
      const updated = await Api.updateDocument(documentId, { title: snapshot.title, content: snapshot.content });
      savedUpdatedAtRef.current = updated.updatedAt;
      setItem<EditorDraft>(draftKey, {
        content: snapshot.content,
        title: snapshot.title,
        savedServerUpdatedAt: updated.updatedAt,
        savedAt: Date.now(),
      });
      setStatusSafe("saved");
      onTitleChange?.(snapshot.title);
      // A restored draft is now safely on the server — drop it so the recovery
      // dialog never prompts for it again (fixes the restore-loop).
      if (draftRestoredRef.current) {
        draftRestoredRef.current = false;
        removeItem(draftKey);
      }
      return snapshot;
    } catch (err) {
      dirtyRef.current = true;
      setStatusSafe("failed");
      toast.error(err instanceof ClientError ? err.message : "Autosave failed");
      return null;
    }
  }, [documentId, draftKey, onTitleChange]);

  const scheduleSave = useCallback(
    (content: TiptapDocument, t: string) => {
      dirtyRef.current = true;
      contentRef.current = content;
      titleRef.current = t;
      if (statusRef.current !== "saving") setStatusSafe("unsaved");
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => void flush(), AUTOSAVE_DEBOUNCE_MS);
      onEditorChanged?.();
    },
    [flush, onEditorChanged],
  );

  const editor = useEditor({
    extensions: buildEditorExtensions("Start typing… use “/” for commands"),
    content: initialContent,
    editable: canEdit,
    editorProps: {
      attributes: { class: "outline-none" },
    },
    onUpdate: ({ editor }) => {
      const json = editor.getJSON() as TiptapDocument;
      persistDraft(json, titleRef.current);
      scheduleSave(json, titleRef.current);
      // remember caret position (throttled)
      try {
        const pos = editor.state.selection.from;
        setItem(positionKey, { pos, at: Date.now() });
      } catch {
        // ignore
      }
    },
  });

  // Expose the imperative API (used by the workspace to flush before publish).
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { flush };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, flush]);

  // Restore caret position from the last session.
  useEffect(() => {
    if (!editor) return;
    const last = getItem<{ pos: number }>(positionKey);
    if (last && typeof last.pos === "number" && last.pos <= editor.state.doc.content.size) {
      editor.commands.setTextSelection(last.pos);
    }
  }, [editor, positionKey]);

  // Draft recovery on mount (§21).
  useEffect(() => {
    if (!editor) return;
    const draft = getItem<EditorDraft>(draftKey);
    if (!draft || !draft.content) return;
    const serverJson = JSON.stringify(initialContent);
    const draftJson = JSON.stringify(draft.content);
    if (draftJson === serverJson) {
      // Draft matches the server — nothing to recover.
      removeItem(draftKey);
      return;
    }
    if (draft.savedServerUpdatedAt === serverUpdatedAt) {
      setDraftPrompt({ kind: "unchanged" });
    } else {
      setDraftPrompt({ kind: "conflict" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  // Track the (unscaled) page height so the zoom wrapper can size itself.
  useEffect(() => {
    const el = pageRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setPageHeight(e.contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track viewport width so the paper container can cap at the screen width.
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  function handleDraftChoice(choice: DraftRecoveryChoice) {
    setDraftPrompt(null);
    if (choice === "draft") {
      const draft = getItem<EditorDraft>(draftKey);
      if (draft?.content && editor) {
        editor.commands.setContent(draft.content as TiptapDocument);
        contentRef.current = draft.content as TiptapDocument;
        titleRef.current = draft.title ?? titleRef.current;
        if (draft.title) setTitle(draft.title);
        dirtyRef.current = true;
        setStatusSafe("unsaved");
        // Persist the restored content immediately (no debounce) so the draft
        // is saved before the user can leave; on success flush() removes the
        // localStorage draft, breaking the repeated-prompt loop.
        draftRestoredRef.current = true;
        void flush();
      }
    } else {
      removeItem(draftKey);
    }
  }

  // Flush pending changes on unload. sendBeacon can only POST, but the
  // document route is PATCH — use a keepalive fetch so the verb is preserved.
  useEffect(() => {
    const flush = () => {
      if (dirtyRef.current) {
        try {
          void fetch(`/api/documents/${documentId}`, {
            method: "PATCH",
            keepalive: true,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: titleRef.current, content: contentRef.current }),
          });
        } catch {
          // ignore
        }
      }
    };
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [documentId]);

  const dirty = status === "unsaved" || status === "failed" || status === "saving";
  const scale = zoom / 100;

  return (
    <div className="flex h-full flex-col bg-muted">
      {editor && <EditorToolbar editor={editor} zoom={zoom} onZoomChange={setZoom} status={status} />}

      {/* Editor workspace — theme canvas around the paper */}
      <div className="min-h-0 flex-1 overflow-auto bg-muted">
        <div className="flex min-h-full justify-center px-2 py-4 sm:px-6 sm:py-10">
          <div
            className="relative shrink-0 overflow-hidden max-w-full"
            style={{ width: Math.min(PAPER_WIDTH * scale, (viewportWidth || PAPER_WIDTH * scale) - 16), height: Math.max(pageHeight * scale, 1) }}
          >
            {/* White paper page */}
            <div
              ref={pageRef}
              className="absolute left-0 top-0 bg-white text-zinc-900 shadow-2xl origin-top-left"
              style={{ width: PAPER_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}
            >
              <div className="px-16 py-14">
                {/* Page header — app chrome, not document content */}
                <div className="mb-10 flex items-center justify-between">
                  <span className="text-[11px] font-medium tracking-wide text-muted-foreground">Documentation Platform</span>
                  <span className="text-[10px] font-semibold tracking-[0.25em] text-muted-foreground">DOC EDITOR</span>
                </div>

                {/* <Input
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    titleRef.current = e.target.value;
                    if (e.target.value !== initialTitle) scheduleSave(contentRef.current, e.target.value);
                    onTitleChange?.(e.target.value);
                    onEditorChanged?.();
                  }}
                  disabled={!canEdit}
                  placeholder="Untitled document"
                  aria-label="Document title"
                  className="mb-8 h-auto border-2 dark:border-red border-red-100 bg-gray p-2 text-2xl text-center font-bold text-zinc-900 shadow-none focus-visible:ring-0 disabled:opacity-100"
                /> */}

                {editor && <EditorContent editor={editor} className={documentBodyClass} />}
              </div>
            </div>
          </div>
        </div>
      </div>

      {editor && canEdit && <EditorBubbleMenu editor={editor} />}
      {editor && canEdit && <SlashCommand editor={editor} />}
      <DraftRecoveryDialog open={draftPrompt !== null} kind={draftPrompt?.kind ?? null} onChoose={handleDraftChoice} />
      <span className="sr-only" aria-live="polite">
        {dirty ? "Unsaved changes" : ""}
      </span>
    </div>
  );
}
