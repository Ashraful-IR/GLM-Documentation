"use client";

/**
 * Thin, typed client for the { success, data | error } envelope (§30).
 * Throws ClientError with the server's error code/message.
 */
export class ClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number = 400,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { ...(init?.headers as Record<string, string> | undefined) };
  if (init?.body && typeof init.body === "string" && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(path, { ...init, headers });
  let body: Envelope<T> | null = null;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    body = null;
  }
  if (!res.ok || !body?.success) {
    throw new ClientError(body?.error?.code ?? "REQUEST_FAILED", body?.error?.message ?? `Request failed (${res.status})`, res.status);
  }
  return body.data as T;
}

export const Api = {
  // auth
  me: () => api<{ id: string; email: string; name: string; role: "ADMIN" | "EDITOR" | "VIEWER"; avatarUrl: string | null } | null>("/api/auth/me"),
  logout: () => api<{ loggedOut: boolean }>("/api/auth/logout", { method: "POST" }),

  // navigation
  getTree: () => api<import("@/types").NavigationNode[]>("/api/navigation"),
  getTrash: () => api<import("@/types").NavigationNode[]>("/api/navigation/trash"),
  emptyTrash: () => api<{ count: number }>("/api/navigation/trash", { method: "DELETE" }),
  createNode: (body: Record<string, unknown>) => api("/api/navigation", { method: "POST", body: JSON.stringify(body) }),
  updateNode: (id: string, body: Record<string, unknown>) => api(`/api/navigation/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteNode: (id: string, permanent = false) => api(`/api/navigation/${id}${permanent ? "?permanent=true" : ""}`, { method: "DELETE" }),
  moveNode: (id: string, body: { parentId: string | null; prevId?: string | null; nextId?: string | null }) =>
    api(`/api/navigation/${id}/move`, { method: "POST", body: JSON.stringify(body) }),
  restoreNode: (id: string) => api(`/api/navigation/${id}/restore`, { method: "POST" }),
  duplicateNode: (id: string) => api(`/api/navigation/${id}/duplicate`, { method: "POST" }),

  // documents
  getDocument: (id: string) => api<import("@/types").DocumentDetail>(`/api/documents/${id}`),
  updateDocument: (id: string, body: Record<string, unknown>) => api<import("@/types").DocumentDetail>(`/api/documents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  publishDocument: (id: string, changeSummary?: string | null) =>
    api(`/api/documents/${id}/publish`, { method: "POST", body: JSON.stringify({ changeSummary }) }),
  checkpointDocument: (id: string, changeSummary?: string | null) =>
    api(`/api/documents/${id}/checkpoint`, { method: "POST", body: JSON.stringify({ changeSummary }) }),
  listVersions: (id: string) => api<import("@/types").DocumentVersionSummary[]>(`/api/documents/${id}/versions`),
  getVersion: (id: string, versionNumber: number) =>
    api<{ id: string; versionNumber: number; title: string; changeSummary: string | null; content: unknown; createdAt: string }>(`/api/documents/${id}/versions/${versionNumber}`),
  restoreVersion: (id: string, versionNumber: number) =>
    api(`/api/documents/${id}/restore`, { method: "POST", body: JSON.stringify({ versionNumber }) }),

  // search & misc
  search: (q: string) => api<import("@/types").SearchResult[]>(`/api/search?q=${encodeURIComponent(q)}`),
  uploadFile: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return api<{ id: string; url: string; originalName: string; mimeType: string; size: number; createdAt: string }>("/api/media", { method: "POST", body: form });
  },
  listMedia: () => api<Array<{ id: string; originalName: string; mimeType: string; size: number; url: string; createdAt: string }>>("/api/media"),
  listUsers: () => api<Array<{ id: string; email: string; name: string; role: "ADMIN" | "EDITOR" | "VIEWER"; avatarUrl: string | null; createdAt: string }>>("/api/users"),
  updateUserRole: (id: string, role: "ADMIN" | "EDITOR" | "VIEWER") =>
    api<{ id: string; role: "ADMIN" | "EDITOR" | "VIEWER" }>(`/api/users/${id}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  listAudit: (page = 1, pageSize = 15) =>
    api<import("@/types").AuditLogPage>(`/api/audit?page=${page}&pageSize=${pageSize}`),
};
