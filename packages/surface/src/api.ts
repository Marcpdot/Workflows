/**
 * Thin HTTP client for the orchestrator integration server.
 * No cognition lives here.
 */

import { SESSION_ID, type ChatDone, type ChatFocus, type StatusResponse } from "./types.js";

const DEFAULT_BASE = "http://127.0.0.1:8787";

export function apiBase(): string {
  const fromEnv = import.meta.env.VITE_ORCHESTRATOR_URL?.trim();
  if (fromEnv === "") return "";
  return (fromEnv || DEFAULT_BASE).replace(/\/$/, "");
}

function token(): string {
  return (
    import.meta.env.VITE_INTEGRATION_HTTP_TOKEN?.trim() ||
    (typeof localStorage !== "undefined"
      ? localStorage.getItem("INTEGRATION_HTTP_TOKEN") || ""
      : "")
  );
}

function authHeaders(): Record<string, string> {
  const t = token();
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function url(path: string): string {
  return `${apiBase()}${path}`;
}

async function readJson<T>(res: Response): Promise<T> {
  const body = (await res.json()) as T & { error?: string; ok?: boolean };
  if (!res.ok) {
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return body;
}

export async function getHealth(): Promise<{ ok: boolean; version?: string }> {
  const res = await fetch(url("/health"), { headers: authHeaders() });
  return readJson(res);
}

export async function getStatus(): Promise<StatusResponse> {
  const res = await fetch(url("/v1/status"), { headers: authHeaders() });
  return readJson(res);
}

export async function getSession(sessionId = SESSION_ID): Promise<{
  sessionId: string;
  exists: boolean;
  historyCount: number;
}> {
  const res = await fetch(
    url(`/v1/session?sessionId=${encodeURIComponent(sessionId)}`),
    { headers: authHeaders() }
  );
  return readJson(res);
}

export interface SseHandler {
  onEvent: (event: string, data: unknown) => void;
  onError?: (err: Error) => void;
}

export async function parseSseStream(
  res: Response,
  onEvent: (event: string, data: unknown) => void
): Promise<void> {
  if (!res.body) throw new Error("SSE response has no body");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let eventName = "message";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    buf = buf.replace(/\r\n/g, "\n");
    let idx = buf.indexOf("\n\n");
    while (idx >= 0) {
      const raw = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      let dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length) {
        const rawData = dataLines.join("\n");
        let parsed: unknown = rawData;
        try {
          parsed = JSON.parse(rawData);
        } catch {
          /* keep string */
        }
        onEvent(eventName, parsed);
      }
      eventName = "message";
      idx = buf.indexOf("\n\n");
    }
  }
}

export function subscribeEvents(
  handlers: SseHandler,
  signal?: AbortSignal
): Promise<void> {
  return fetch(url("/v1/events"), {
    headers: { ...authHeaders(), Accept: "text/event-stream" },
    signal,
  }).then(async (res) => {
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error || `events HTTP ${res.status}`);
    }
    await parseSseStream(res, handlers.onEvent);
  });
}

export async function streamChat(
  prompt: string,
  focus: ChatFocus | undefined,
  onEvent: (event: string, data: unknown) => void
): Promise<ChatDone> {
  const res = await fetch(url("/v1/chat"), {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      prompt,
      sessionId: SESSION_ID,
      stream: true,
      ...(focus && Object.keys(focus).length ? { focus } : {}),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `chat HTTP ${res.status}`);
  }
  let done: ChatDone | undefined;
  let streamError: string | null = null;
  await parseSseStream(res, (event, data) => {
    onEvent(event, data);
    if (event === "done" && data && typeof data === "object") {
      done = data as ChatDone;
    }
    if (event === "error") {
      const err = data as { error?: string };
      streamError = err.error || "stream error";
    }
  });
  if (streamError) throw new Error(streamError);
  if (!done) throw new Error("chat stream ended without done");
  return done;
}

export async function searchNodes(label: string, type?: string): Promise<{
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    description?: string;
    status: string;
  }>;
  count: number;
}> {
  const q = new URLSearchParams({ status: "accepted", limit: "30" });
  if (label.trim()) q.set("label", label.trim());
  if (type) q.set("type", type);
  const res = await fetch(url(`/v1/knowledge/search?${q}`), {
    headers: authHeaders(),
  });
  return readJson(res);
}

export async function getNode(id: string): Promise<{
  ok: true;
  node: {
    id: string;
    type: string;
    label: string;
    description?: string;
    status: string;
    workspaceId?: string | null;
  };
}> {
  const res = await fetch(
    url(`/v1/knowledge/node?id=${encodeURIComponent(id)}`),
    { headers: authHeaders() }
  );
  return readJson(res);
}

export async function getNeighborhood(nodeId: string): Promise<{
  rootId: string;
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    status: string;
  }>;
  edges: Array<{
    id: string;
    fromNodeId: string;
    relation: string;
    toNodeId: string;
  }>;
}> {
  const res = await fetch(
    url(
      `/v1/knowledge/neighborhood?nodeId=${encodeURIComponent(nodeId)}&hops=1`
    ),
    { headers: authHeaders() }
  );
  return readJson(res);
}

export async function listProposals(sessionId: string): Promise<{
  proposals: Array<Record<string, unknown>>;
  count: number;
}> {
  const res = await fetch(
    url(`/v1/knowledge/proposals?sessionId=${encodeURIComponent(sessionId)}`),
    { headers: authHeaders() }
  );
  if (res.status === 404) {
    return { proposals: [], count: 0 };
  }
  return readJson(res);
}

export async function resolveProposal(
  id: string,
  action: "accept" | "reject"
): Promise<void> {
  const res = await fetch(
    url(`/v1/knowledge/proposals/${encodeURIComponent(id)}/${action}`),
    { method: "POST", headers: authHeaders() }
  );
  await readJson(res);
}
