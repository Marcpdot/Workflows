/**
 * Thin HTTP surface — delegates to Orchestrator; no parallel brain.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createKnowledgeReader,
  createKnowledgeStore,
  createKnowledgeTools,
  listPendingForSession,
  renderKnowledgeBrowseHtml,
  type KnowledgeNodeType,
  type KnowledgeStatus,
} from "@workflows/knowledge";
import { Orchestrator, loadConfigFromEnv } from "../orchestrator.js";
import { tryHandleSessionCommand } from "../sessionCommands.js";
import { createMemory } from "@workflows/memory";
import { createRegistryFromConfig } from "@workflows/tools";
import { resolveWorkspace } from "@workflows/workspace";
import type {
  IntegrationChatRequest,
  IntegrationChatResponse,
  IntegrationErrorResponse,
  IntegrationFocus,
  IntegrationHealthResponse,
  IntegrationSessionResponse,
} from "./types.js";
import { initSse, writeSse } from "./sse.js";
import { SurfaceEventHub } from "./surfaceEvents.js";
import { collectIntegrationStatus } from "./surfaceStatus.js";

function envFlagTrue(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function knowledgeHttpReadEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return envFlagTrue(env.KNOWLEDGE_HTTP_READ);
}

/**
 * createRegistryFromConfig() rebuilds built-ins only and drops tools that
 * loadConfigFromEnv already registered (knowledge_*). Re-attach them.
 */
async function attachKnowledgeToolsToRegistry(
  config: ReturnType<typeof loadConfigFromEnv>
): Promise<void> {
  if (!config.tools) return;
  config.tools = await createRegistryFromConfig();
  if (
    config.knowledge &&
    envFlagTrue(process.env.KNOWLEDGE_TOOLS_ENABLED)
  ) {
    for (const t of createKnowledgeTools(config.knowledge)) {
      config.tools.register(t);
    }
  }
}

export interface HttpServerOptions {
  host?: string;
  port?: number;
  /** If set, require Authorization: Bearer <token> */
  token?: string;
  version?: string;
  /** Optional static files root (M6 web UI) */
  staticDir?: string;
  /** Explicit URL-to-file aliases for vendored browser dependencies. */
  staticFiles?: Record<string, string>;
  /** Expose the accepted knowledge read catalog on this server. */
  knowledgeReadEnabled?: boolean;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function isLocalBrowserOrigin(origin: string | undefined): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

/** Allow the separate work-surface package on localhost to call 127.0.0.1:8787. */
function applyLocalCors(req: IncomingMessage, res: ServerResponse): void {
  const origin = req.headers.origin;
  if (!isLocalBrowserOrigin(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin!);
  res.setHeader("Vary", "Origin");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", Buffer.byteLength(payload));
  res.writeHead(status);
  res.end(payload);
}

function unauthorized(res: ServerResponse): void {
  sendJson(res, 401, {
    ok: false,
    error: "Unauthorized",
  } satisfies IntegrationErrorResponse);
}

function checkAuth(
  req: IncomingMessage,
  token: string | undefined
): boolean {
  if (!token) return true;
  const h = req.headers.authorization ?? "";
  return h === `Bearer ${token}` || h === `bearer ${token}`;
}

function wantsChatStream(
  req: IncomingMessage,
  parsed: IntegrationChatRequest
): boolean {
  if (parsed.stream === true) return true;
  if (parsed.stream === false) return false;
  const accept = req.headers.accept ?? "";
  return accept.includes("text/event-stream");
}

function parseFocus(raw: unknown): IntegrationFocus | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("focus must be an object");
  }
  const o = raw as Record<string, unknown>;
  const focus: IntegrationFocus = {};
  if (o.nodeIds != null) {
    if (
      !Array.isArray(o.nodeIds) ||
      o.nodeIds.some((id) => typeof id !== "string")
    ) {
      throw new Error("focus.nodeIds must be string[]");
    }
    focus.nodeIds = o.nodeIds.map((id) => id.trim()).filter(Boolean);
  }
  if (o.labels != null) {
    if (
      !Array.isArray(o.labels) ||
      o.labels.some((label) => typeof label !== "string")
    ) {
      throw new Error("focus.labels must be string[]");
    }
    focus.labels = o.labels.map((label) => label.trim()).filter(Boolean);
  }
  if (o.projectId != null) {
    if (typeof o.projectId !== "string") {
      throw new Error("focus.projectId must be a string");
    }
    const id = o.projectId.trim();
    if (id) focus.projectId = id;
  }
  if (o.projectLabel != null) {
    if (typeof o.projectLabel !== "string") {
      throw new Error("focus.projectLabel must be a string");
    }
    const label = o.projectLabel.trim();
    if (label) focus.projectLabel = label;
  }
  if (o.hops != null) {
    if (o.hops !== 1 && o.hops !== 2) {
      throw new Error("focus.hops must be 1 or 2");
    }
    focus.hops = o.hops;
  }
  if (o.knowledgeId != null) {
    if (typeof o.knowledgeId !== "string") {
      throw new Error("focus.knowledgeId must be a string");
    }
    const id = o.knowledgeId.trim();
    if (id) {
      focus.knowledgeId = id;
      if (!focus.nodeIds?.includes(id)) {
        focus.nodeIds = [...(focus.nodeIds ?? []), id];
      }
    }
  }
  if (o.workspaceId != null) {
    if (typeof o.workspaceId !== "string") {
      throw new Error("focus.workspaceId must be a string");
    }
    const id = o.workspaceId.trim();
    if (id) focus.workspaceId = id;
  }
  return focus;
}

function matchProposalAction(
  path: string
): { id: string; action: "accept" | "reject" } | null {
  const m = path.match(
    /^\/v1\/knowledge\/proposals\/([^/]+)\/(accept|reject)$/
  );
  if (!m) return null;
  try {
    return {
      id: decodeURIComponent(m[1]!),
      action: m[2] as "accept" | "reject",
    };
  } catch {
    return null;
  }
}

function resolveSessionIds(input: {
  sessionId?: string;
  workspaceRoot?: string;
}): {
  sessionId: string;
  logicalSessionId: string;
  workspaceId: string;
  workspaceRoot: string;
} {
  const raw = input.sessionId?.trim();
  const namespaced = raw?.match(/^ws:([a-f0-9]{12}):(.+)$/i);
  if (raw && namespaced) {
    const ws = resolveWorkspace({ workspaceRoot: input.workspaceRoot });
    return {
      sessionId: raw,
      logicalSessionId: namespaced[2]!,
      workspaceId: namespaced[1]!,
      workspaceRoot: ws.rootPath,
    };
  }
  const ws = resolveWorkspace({
    workspaceRoot: input.workspaceRoot,
    sessionId: raw,
  });
  return {
    sessionId: ws.sessionId,
    logicalSessionId: ws.logicalSessionId,
    workspaceId: ws.id,
    workspaceRoot: ws.rootPath,
  };
}

function packageVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), "package.json"), "utf8")
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function tryServeStatic(
  res: ServerResponse,
  staticDir: string,
  urlPath: string
): boolean {
  const root = resolve(staticDir);
  let rel = decodeURIComponent(urlPath.split("?")[0] ?? "/");
  if (rel === "/") rel = "/index.html";
  const candidate = normalize(join(root, rel.replace(/^[/\\]+/, "")));
  if (!candidate.startsWith(root + sep) && candidate !== root) {
    return false;
  }
  if (!existsSync(candidate) || !statSync(candidate).isFile()) {
    return false;
  }
  const body = readFileSync(candidate);
  const type = MIME[extname(candidate).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": body.length,
  });
  res.end(body);
  return true;
}

export function createIntegrationServer(
  options: HttpServerOptions = {}
): Server {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 8787;
  const token = options.token;
  const version = options.version ?? packageVersion();
  const staticDir = options.staticDir
    ? resolve(options.staticDir)
    : undefined;
  const staticFiles = Object.fromEntries(
    Object.entries(options.staticFiles ?? {}).map(([urlPath, filePath]) => [
      urlPath,
      resolve(filePath),
    ])
  );
  const knowledgeReadEnabled =
    options.knowledgeReadEnabled ?? knowledgeHttpReadEnabled();
  const events = new SurfaceEventHub();
  let inflightChats = 0;

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const path = url.pathname;
      applyLocalCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      if (
        staticDir &&
        req.method === "GET" &&
        !path.startsWith("/v1/") &&
        path !== "/health"
      ) {
        const staticFile = staticFiles[path];
        if (staticFile && existsSync(staticFile) && statSync(staticFile).isFile()) {
          const body = readFileSync(staticFile);
          const type = MIME[extname(staticFile).toLowerCase()] ?? "application/octet-stream";
          res.writeHead(200, {
            "Content-Type": type,
            "Content-Length": body.length,
          });
          res.end(body);
          return;
        }
        if (tryServeStatic(res, staticDir, path)) return;
        if (tryServeStatic(res, staticDir, "/index.html")) return;
      }

      if (req.method === "GET" && path === "/health") {
        if (!checkAuth(req, token)) {
          unauthorized(res);
          return;
        }
        const body: IntegrationHealthResponse = {
          ok: true,
          service: "orchestrator",
          version,
        };
        sendJson(res, 200, body);
        return;
      }

      if (req.method === "GET" && path === "/v1/status") {
        if (!checkAuth(req, token)) {
          unauthorized(res);
          return;
        }
        const body = await collectIntegrationStatus({
          version,
          busy: inflightChats > 0,
        });
        sendJson(res, 200, body);
        return;
      }

      if (req.method === "GET" && path === "/v1/events") {
        if (!checkAuth(req, token)) {
          unauthorized(res);
          return;
        }
        events.subscribe(req, res, {
          service: "orchestrator",
          version,
          busy: inflightChats > 0,
        });
        return;
      }

      if (req.method === "GET" && path === "/v1/session") {
        if (!checkAuth(req, token)) {
          unauthorized(res);
          return;
        }
        await handleSessionMetadata(req, res, url);
        return;
      }

      const proposalAction =
        req.method === "POST" ? matchProposalAction(path) : null;
      if (proposalAction) {
        if (!checkAuth(req, token)) {
          unauthorized(res);
          return;
        }
        await handleProposalAction(req, res, proposalAction, events);
        return;
      }

      if (
        req.method === "GET" &&
        path.startsWith("/v1/knowledge") &&
        (knowledgeReadEnabled ||
          path === "/v1/knowledge/proposals" ||
          path === "/v1/knowledge" ||
          path === "/v1/knowledge/")
      ) {
        if (!checkAuth(req, token)) {
          unauthorized(res);
          return;
        }
        await handleKnowledgeRead(req, res, path, url);
        return;
      }

      if (
        knowledgeReadEnabled &&
        req.method === "GET" &&
        (path === "/knowledge" || path === "/knowledge/")
      ) {
        const html = renderKnowledgeBrowseHtml({ apiBase: "" });
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Length": Buffer.byteLength(html),
        });
        res.end(html);
        return;
      }

      if (req.method === "POST" && path === "/v1/chat") {
        if (!checkAuth(req, token)) {
          unauthorized(res);
          return;
        }

        const raw = await readBody(req);
        let parsed: IntegrationChatRequest;
        try {
          parsed = JSON.parse(raw) as IntegrationChatRequest;
        } catch {
          sendJson(res, 400, {
            ok: false,
            error: "Invalid JSON body",
          } satisfies IntegrationErrorResponse);
          return;
        }

        if (!parsed.prompt || typeof parsed.prompt !== "string") {
          sendJson(res, 400, {
            ok: false,
            error: "prompt (string) is required",
          } satisfies IntegrationErrorResponse);
          return;
        }
        if (parsed.stream != null && typeof parsed.stream !== "boolean") {
          sendJson(res, 400, {
            ok: false,
            error: "stream must be a boolean",
          } satisfies IntegrationErrorResponse);
          return;
        }

        let focus: IntegrationFocus | undefined;
        try {
          focus = parseFocus(parsed.focus);
        } catch (err) {
          sendJson(res, 400, {
            ok: false,
            error: err instanceof Error ? err.message : String(err),
          } satisfies IntegrationErrorResponse);
          return;
        }
        parsed = { ...parsed, focus };

        const stream = wantsChatStream(req, parsed);
        const sessionHint = parsed.sessionId?.trim();
        events.emit({ type: "turn.started", sessionId: sessionHint });
        inflightChats += 1;
        try {
          if (stream) {
            initSse(res);
            writeSse(res, "status", { phase: "accepted" });
            writeSse(res, "status", { phase: "running" });
          }
          const body = await executeChat(parsed);
          publishChatObservations(events, body);
          if (stream) {
            writeSse(res, "status", { phase: "complete" });
            if (body.reply) writeSse(res, "token", { text: body.reply });
            writeSse(res, "done", body);
            res.end();
          } else {
            sendJson(res, 200, body);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          events.emit({
            type: "turn.failed",
            sessionId: sessionHint,
            error: message,
          });
          events.emit({ type: "error", error: message, sessionId: sessionHint });
          if (stream && res.headersSent) {
            writeSse(res, "error", {
              ok: false,
              error: message,
            } satisfies IntegrationErrorResponse);
            res.end();
          } else {
            sendJson(res, 500, {
              ok: false,
              error: message,
            } satisfies IntegrationErrorResponse);
          }
        } finally {
          inflightChats = Math.max(0, inflightChats - 1);
        }
        return;
      }

      sendJson(res, 404, {
        ok: false,
        error: `Not found: ${req.method} ${path}`,
      } satisfies IntegrationErrorResponse);
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies IntegrationErrorResponse);
    }
  });

  (server as Server & { __integration?: { host: string; port: number } }).__integration =
    { host, port };

  return server;
}

export function listenIntegrationServer(
  options: HttpServerOptions = {}
): Promise<{ server: Server; url: string }> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? Number(process.env.INTEGRATION_HTTP_PORT ?? 8787);
  const token = options.token ?? process.env.INTEGRATION_HTTP_TOKEN;
  const server = createIntegrationServer({ ...options, host, port, token });

  return new Promise((resolveListen, reject) => {
    server.listen(port, host, () => {
      resolveListen({
        server,
        url: `http://${host}:${port}`,
      });
    });
    server.on("error", reject);
  });
}

function publishChatObservations(
  events: SurfaceEventHub,
  body: IntegrationChatResponse
): void {
  events.emit({
    type: "turn.completed",
    sessionId: body.sessionId,
    latencyMs: body.latencyMs,
    command: Boolean(body.command),
    proposalCount: body.proposals?.length ?? 0,
  });
  for (const proposal of body.proposals ?? []) {
    events.emit({
      type: "proposal.created",
      sessionId: body.sessionId,
      proposalId: proposal.id,
      kind: proposal.kind,
    });
  }
  const degradations = body.activation?.degradations ?? [];
  if (degradations.length) {
    events.emit({
      type: "degraded",
      sessionId: body.sessionId,
      capabilities: degradations.map((d) => d.capabilityId),
    });
  }
}

async function executeChat(
  parsed: IntegrationChatRequest
): Promise<IntegrationChatResponse> {
  const started = performance.now();

  if (parsed.options?.toolsEnabled != null) {
    process.env.TOOLS_ENABLED = parsed.options.toolsEnabled
      ? "true"
      : "false";
  }

  const ws = resolveWorkspace({
    workspaceRoot: parsed.workspaceRoot,
    sessionId: parsed.sessionId,
  });
  process.env.WORKSPACE_ROOT = ws.rootPath;

  const config = loadConfigFromEnv(process.env, {
    workspaceRoot: ws.rootPath,
    sessionId: ws.logicalSessionId,
  });
  await attachKnowledgeToolsToRegistry(config);
  const sessionId = ws.sessionId;
  const useMemory = !parsed.options?.noMemory;
  const memory = useMemory
    ? createMemory({
        dbPath: resolve(
          process.cwd(),
          process.env.MEMORY_DB_PATH ?? "./data/memory.db"
        ),
      })
    : null;
  config.experienceStore = memory ?? undefined;
  const orch = new Orchestrator(config);

  let historyCount = 0;
  try {
    let history: { role: "user" | "assistant" | "system"; content: string }[] =
      [];
    try {
      if (memory) {
        history = await memory.getHistory(sessionId);
        historyCount = history.length;
      }

      const cmd = await tryHandleSessionCommand(parsed.prompt, {
        memory,
        sessionId,
        knowledge: orch.knowledge,
      });
      if (cmd.kind === "handled") {
        if (memory) {
          const inputExperience = await memory.addMessage(
            sessionId,
            { role: "user", content: parsed.prompt },
            { workspaceId: ws.id, source: { type: "http" } }
          );
          await memory.addMessage(
            sessionId,
            { role: "assistant", content: cmd.message },
            {
              workspaceId: ws.id,
              source: { type: "command" },
              parentExperienceIds: [inputExperience.id],
            }
          );
        }
        return {
          reply: cmd.message,
          sessionId,
          logicalSessionId: ws.logicalSessionId,
          historyCount,
          latencyMs: Math.round(performance.now() - started),
          workspaceRoot: config.workspaceRoot,
          workspaceId: ws.id,
          interactionMode: cmd.sessionState?.interactionMode,
          proposalsEnabled: cmd.sessionState?.proposalsEnabled,
          command: true,
          data: cmd.data,
          focus: parsed.focus,
        } as IntegrationChatResponse;
      }

      const sessionState = memory
        ? await memory.getSessionState(sessionId)
        : null;
      const forceCapture = cmd.kind === "force_capture";
      const promptForModel =
        forceCapture && cmd.restPrompt === "capture last segment"
          ? "(Session capture of recent conversation — acknowledge briefly.)"
          : forceCapture
            ? cmd.restPrompt
            : parsed.prompt;

      const lastExtractAt = sessionState?.lastExtractTurnId
        ? Number(sessionState.lastExtractTurnId)
        : undefined;
      const result = await orch.handle(promptForModel, {
        history,
        forceModel: parsed.options?.forceModel,
        sessionId,
        interactionMode: sessionState?.interactionMode ?? "active",
        proposalsEnabled: sessionState?.proposalsEnabled ?? true,
        forceCapture,
        maxProposalsPerTurn: sessionState?.maxProposalsPerTurn,
        minUserMessageLength: sessionState?.minUserMessageLength,
        lastExtractAt: Number.isFinite(lastExtractAt)
          ? lastExtractAt
          : undefined,
        sourcePrompt: parsed.prompt,
        experienceSource: { type: "http" },
        experienceMetadata: parsed.focus
          ? { focus: parsed.focus }
          : undefined,
        focus: parsed.focus,
      });

      if (memory && result.capture?.ran) {
        await memory.updateSessionState(sessionId, {
          lastExtractTurnId: String(Date.now()),
        });
      }

      return {
        ...result,
        sessionId,
        logicalSessionId: ws.logicalSessionId,
        historyCount,
        latencyMs: Math.round(performance.now() - started),
        workspaceRoot: config.workspaceRoot,
        workspaceId: ws.id,
        focus: parsed.focus,
      };
    } finally {
      memory?.close();
    }
  } finally {
    orch.close();
  }
}

async function handleSessionMetadata(
  _req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  const rawSession = url.searchParams.get("sessionId")?.trim();
  if (!rawSession) {
    sendJson(res, 400, {
      ok: false,
      error: "sessionId query param required",
    } satisfies IntegrationErrorResponse);
    return;
  }
  const ids = resolveSessionIds({
    sessionId: rawSession,
    workspaceRoot: url.searchParams.get("workspaceRoot")?.trim() || undefined,
  });
  const memory = createMemory({
    dbPath: resolve(
      process.cwd(),
      process.env.MEMORY_DB_PATH ?? "./data/memory.db"
    ),
  });
  try {
    const sessions = await memory.listSessions();
    const exists = sessions.includes(ids.sessionId);
    const history = exists
      ? await memory.getHistoryRecords(ids.sessionId, 10_000)
      : [];
    const state = await memory.getSessionState(ids.sessionId);
    sendJson(res, 200, {
      ok: true,
      sessionId: ids.sessionId,
      logicalSessionId: ids.logicalSessionId,
      workspaceId: ids.workspaceId,
      workspaceRoot: ids.workspaceRoot,
      exists,
      historyCount: history.length,
      interactionMode: state.interactionMode,
      proposalsEnabled: state.proposalsEnabled,
      lastExtractTurnId: state.lastExtractTurnId,
      updatedAt: state.updatedAt,
    } satisfies IntegrationSessionResponse);
  } finally {
    memory.close();
  }
}

async function handleProposalAction(
  req: IncomingMessage,
  res: ServerResponse,
  action: { id: string; action: "accept" | "reject" },
  events: SurfaceEventHub
): Promise<void> {
  if (!action.id.trim()) {
    sendJson(res, 400, {
      ok: false,
      error: "proposal id required",
    } satisfies IntegrationErrorResponse);
    return;
  }
  let edits: Record<string, unknown> | undefined;
  const raw = await readBody(req);
  if (raw.trim()) {
    try {
      const parsed = JSON.parse(raw) as { edits?: unknown };
      if (parsed.edits != null) {
        if (
          typeof parsed.edits !== "object" ||
          Array.isArray(parsed.edits)
        ) {
          sendJson(res, 400, {
            ok: false,
            error: "edits must be an object",
          } satisfies IntegrationErrorResponse);
          return;
        }
        edits = parsed.edits as Record<string, unknown>;
      }
    } catch {
      sendJson(res, 400, {
        ok: false,
        error: "Invalid JSON body",
      } satisfies IntegrationErrorResponse);
      return;
    }
  }

  const store = createKnowledgeStore();
  try {
    if (action.action === "accept") {
      await store.acceptProposal(action.id, edits);
    } else {
      await store.rejectProposal(action.id);
    }
    sendJson(res, 200, {
      ok: true,
      id: action.id,
      action: action.action,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const lower = message.toLowerCase();
    const status = lower.includes("unknown id")
      ? 404
      : lower.includes("already")
        ? 409
        : 400;
    if (status >= 500) {
      events.emit({ type: "error", error: message });
    }
    sendJson(res, status, {
      ok: false,
      error: message,
    } satisfies IntegrationErrorResponse);
  } finally {
    try {
      await store.close();
    } catch {
      /* ignore */
    }
  }
}

async function handleKnowledgeRead(
  _req: IncomingMessage,
  res: ServerResponse,
  path: string,
  url: URL
): Promise<void> {
  const store = createKnowledgeStore();
  const reader = createKnowledgeReader(store);
  try {
    const q = url.searchParams;

    if (path === "/v1/knowledge/node") {
      const id = q.get("id")?.trim();
      if (!id) {
        sendJson(res, 400, { ok: false, error: "id query param required" });
        return;
      }
      const node = await reader.getNode(id);
      if (!node) {
        sendJson(res, 404, { ok: false, error: `node not found: ${id}` });
        return;
      }
      sendJson(res, 200, { ok: true, node });
      return;
    }

    if (path === "/v1/knowledge/search") {
      const result = await reader.search({
        label: q.get("label") ?? undefined,
        type: (q.get("type") as KnowledgeNodeType | null) ?? undefined,
        status: (q.get("status") as KnowledgeStatus | null) ?? "accepted",
        workspaceId: q.get("workspaceId") ?? undefined,
        limit: q.get("limit") ? Number(q.get("limit")) : 20,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (path === "/v1/knowledge/neighborhood") {
      const nodeId = q.get("nodeId")?.trim() ?? q.get("id")?.trim();
      if (!nodeId) {
        sendJson(res, 400, {
          ok: false,
          error: "nodeId (or id) query param required",
        });
        return;
      }
      const hops = q.get("hops") === "2" ? 2 : 1;
      const result = await reader.getNeighborhood(nodeId, {
        hops: hops as 1 | 2,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (path === "/v1/knowledge/subgraph") {
      const nodeIds = (q.get("nodeIds") ?? "")
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      const result = await reader.getSubgraph({
        rootId: q.get("rootId")?.trim() || undefined,
        nodeIds: nodeIds.length ? nodeIds : undefined,
        hops: q.get("hops") === "2" ? 2 : 1,
        status: (q.get("status") as KnowledgeStatus | null) ?? "accepted",
        workspaceId: q.has("workspaceId")
          ? q.get("workspaceId")
          : undefined,
        limit: q.get("limit") ? Number(q.get("limit")) : 250,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (path === "/v1/knowledge/project-status") {
      const label = q.get("label")?.trim() ?? undefined;
      const projectId = q.get("projectId")?.trim() ?? undefined;
      if (!label && !projectId) {
        sendJson(res, 400, {
          ok: false,
          error: "label or projectId required",
        });
        return;
      }
      try {
        const status = await reader.getProjectStatus({
          label,
          projectId,
          hops: q.get("hops") === "2" ? 2 : 1,
        });
        sendJson(res, 200, { ok: true, status });
      } catch (err) {
        sendJson(res, 404, {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return;
    }

    if (path === "/v1/knowledge/contradictions") {
      const result = await reader.findContradictions({
        nodeId: q.get("nodeId")?.trim() ?? undefined,
        limit: q.get("limit") ? Number(q.get("limit")) : 50,
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (path === "/v1/knowledge/proposals") {
      const sessionId = q.get("sessionId")?.trim();
      if (sessionId) {
        const proposals = await listPendingForSession(store, sessionId);
        sendJson(res, 200, {
          ok: true,
          sessionId,
          status: "pending",
          proposals,
          count: proposals.length,
        });
        return;
      }
      const st = q.get("status")?.trim() as
        | "pending"
        | "accepted"
        | "rejected"
        | undefined;
      const result = await reader.listProposals({
        status: st ?? "pending",
      });
      sendJson(res, 200, { ok: true, ...result });
      return;
    }

    if (path === "/v1/knowledge" || path === "/v1/knowledge/") {
      sendJson(res, 200, {
        ok: true,
        service: "knowledge-read",
        routes: [
          "GET /v1/knowledge/node?id=",
          "GET /v1/knowledge/search?label=&type=&status=",
          "GET /v1/knowledge/neighborhood?nodeId=&hops=1|2",
          "GET /v1/knowledge/subgraph?rootId=|nodeIds=&hops=1|2&limit=250",
          "GET /v1/knowledge/project-status?label=|projectId=",
          "GET /v1/knowledge/contradictions?nodeId=",
          "GET /v1/knowledge/proposals?status=pending",
          "GET /v1/knowledge/proposals?sessionId= (session pending queue)",
          "POST /v1/knowledge/proposals/:id/accept",
          "POST /v1/knowledge/proposals/:id/reject",
          "GET /knowledge  (minimal HTML browse)",
        ],
      });
      return;
    }

    sendJson(res, 404, {
      ok: false,
      error: `Unknown knowledge read path: ${path}`,
    });
  } finally {
    store.close();
  }
}

export function knowledgeBrowseHtmlPath(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "knowledge-ui", "index.html");
  } catch {
    return resolve(process.cwd(), "src/integration/knowledge-ui/index.html");
  }
}
