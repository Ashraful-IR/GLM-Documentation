/**
 * All localStorage access goes through this module (§20).
 * PostgreSQL remains the source of truth; these keys are client-side cache
 * and draft state only.
 */
export const STORAGE_KEYS = {
  navigation: "documentation:navigation",
  recentDocuments: "documentation:recent-documents",
  editorDraft: (documentId: string) => `documentation:editor:draft:${documentId}`,
  editorLastPosition: (documentId: string) => `documentation:editor:last-position:${documentId}`,
  sidebarState: "documentation:ui:sidebar-state",
  sidebarCollapsed: "documentation:ui:sidebar-collapsed",
  theme: "documentation:ui:theme",
} as const;

function isClient(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function getItem<T>(key: string): T | null {
  if (!isClient()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Returns false when the write failed (storage full or unavailable). Callers
 * that must react to a dropped draft (e.g. the editor) use this to warn once
 * instead of losing draft state silently.
 */
export function setItem<T>(key: string, value: T): boolean {
  if (!isClient()) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    // QuotaExceededError / privacy mode — surface instead of swallowing so
    // very large drafts failing to persist are at least diagnosable.
    console.warn(`[storage] could not persist "${key}" (quota exceeded or unavailable)`, err);
    return false;
  }
}

export function removeItem(key: string): void {
  if (!isClient()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

export interface EditorDraft {
  content: unknown;
  title?: string;
  savedServerUpdatedAt: string | null; // snapshot used for conflict detection (§21)
  savedAt: number;
}
