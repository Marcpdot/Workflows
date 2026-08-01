/**
 * Thin HTTP surface — delegates to Orchestrator; no parallel brain.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve, sep } from "node:path";
import { Orchestrator, loadConfigFromEnv } from "../orchestrator.js";
import { createMemory } from "../memory/index.js";
import { createRegistryFromConfig } from "../tools/index.js";
import type {
  IntegrationChatRequest,
  IntegrationChatResponse,
  IntegrationErrorResponse,
  IntegrationHealthResponse,
} from "./types.js";

export interface HttpServerOptions {
  host?: string;
  port?: number;
  /** If set, require Authorization: Bearer <token> */
  token?: string;
  version?: string;
  /** Optional static files root (M6 web UI) */
  staticDir?: string;
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

        // Apply workspace for this request
        if (parsed.workspaceRoot?.trim()) {
          process.env.WORKSPACE_ROOT = parsed.workspaceRoot.trim();
        }
        if (parsed.options?.toolsEnabled != null) {
          process.env.TOOLS_ENABLED = parsed.options.toolsEnabled
            ? "true"
            : "false";
        }

        const config = loadConfigFromEnv();
        if (config.tools) {
          config.tools = await createRegistryFromConfig();
        }
        if (parsed.workspaceRoot?.trim()) {
          config.workspaceRoot = resolve(parsed.workspaceRoot.trim());
        }

        const orch = new Orchestrator(config);
        const sessionId = parsed.sessionId?.trim() || "default";
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

            const result = await orch.handle(parsed.prompt, {
              history,
              forceModel: parsed.options?.forceModel,
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
            }

            const response: IntegrationChatResponse = {
              ...result,
              sessionId,
              historyCount,
              latencyMs: Math.round(performance.now() - started),
              workspaceRoot: config.workspaceRoot,
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
