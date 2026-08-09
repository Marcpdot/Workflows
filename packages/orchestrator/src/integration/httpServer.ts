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
  IntegrationHealthResponse,
} from "./types.js";

function envFlagTrue(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes";
}

function knowledgeHttpReadEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return envFlagTrue(env.KNOWLEDGE_HTTP_READ);
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

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
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
  // Prevent path escape
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

/**
 * Create an HTTP server that uses loadConfigFromEnv + Orchestrator per request
 * (workspace override applied on config copy).
 * Optional staticDir serves a minimal web UI (M6) from the same origin as /v1/chat.
 */
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

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", `http://${host}:${port}`);
      const path = url.pathname;

      // Static UI (no auth) — same host as API for simple fetch
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
        // SPA-style fallback to index.html for unknown GETs under UI
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

      // M17/M-capture: knowledge read API (same token gate as /v1/*)
      // Full catalog behind KNOWLEDGE_HTTP_READ; session pending queue always on (UI panel).
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

      // M17: minimal knowledge browse HTML (no auth for static shell; API still gated)
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

        const started = performance.now();

        if (parsed.options?.toolsEnabled != null) {
          process.env.TOOLS_ENABLED = parsed.options.toolsEnabled
            ? "true"
            : "false";
        }

        // M9: per-request workspace + namespaced session
        const ws = resolveWorkspace({
          workspaceRoot: parsed.workspaceRoot,
          sessionId: parsed.sessionId,
        });
        process.env.WORKSPACE_ROOT = ws.rootPath;

        const config = loadConfigFromEnv(process.env, {
          workspaceRoot: ws.rootPath,
          sessionId: ws.logicalSessionId,
        });
        if (config.tools) {
          config.tools = await createRegistryFromConfig();
        }

        const orch = new Orchestrator(config);
        const sessionId = ws.sessionId;
        const useMemory = !parsed.options?.noMemory;

        let historyCount = 0;
        try {
          let history: { role: "user" | "assistant" | "system"; content: string }[] =
            [];
          const memory = useMemory
            ? createMemory({
                dbPath: resolve(
                  process.cwd(),
                  process.env.MEMORY_DB_PATH ?? "./data/memory.db"
                ),
              })
            : null;

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
              sendJson(res, 200, {
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
              });
              return;
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
            });

            if (memory) {
              await memory.add(sessionId, {
                role: "user",
                content: parsed.prompt,
              });
              await memory.add(sessionId, {
                role: "assistant",
                content: result.reply,
              });
              if (result.capture?.ran) {
                await memory.updateSessionState(sessionId, {
                  lastExtractTurnId: String(Date.now()),
                });
              }
            }

            const response: IntegrationChatResponse = {
              ...result,
              sessionId,
              logicalSessionId: ws.logicalSessionId,
              historyCount,
              latencyMs: Math.round(performance.now() - started),
              workspaceRoot: config.workspaceRoot,
              workspaceId: ws.id,
            };
            sendJson(res, 200, response);
          } finally {
            memory?.close();
          }
        } finally {
          orch.close();
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

  // stash for listen helpers
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

/**
 * GET /v1/knowledge/node|search|neighborhood|subgraph|project-status|contradictions|proposals
 */
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
        // Full session-scoped pending queue (interaction capture iteration)
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

    // Index of available read routes
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

/** Path to optional static knowledge HTML file on disk (for packaging). */
export function knowledgeBrowseHtmlPath(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, "knowledge-ui", "index.html");
  } catch {
    return resolve(process.cwd(), "src/integration/knowledge-ui/index.html");
  }
}
