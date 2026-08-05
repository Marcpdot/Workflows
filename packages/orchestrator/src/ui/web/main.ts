/**
 * M6 web UI entry — static shell + M5 /v1/chat on the same localhost server.
 *
 *   npm run ui
 *   UI_PORT=8787 UI_HOST=127.0.0.1
 */

import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { listenIntegrationServer } from "../../integration/httpServer.js";

function loadDotEnv(filePath = resolve(process.cwd(), ".env")): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const host = process.env.UI_HOST?.trim() || "127.0.0.1";
  const port = Number(
    process.env.UI_PORT ?? process.env.INTEGRATION_HTTP_PORT ?? 8787
  );
  const here = dirname(fileURLToPath(import.meta.url));
  const staticDir = resolve(here, "public");

  const { url } = await listenIntegrationServer({
    host,
    port,
    token: process.env.INTEGRATION_HTTP_TOKEN,
    staticDir,
    knowledgeReadEnabled: true,
  });

  console.error(`Orchestrator web UI (M6) at ${url}`);
  console.error(`  UI:     ${url}/`);
  console.error(`  health: ${url}/health`);
  console.error(`  chat:   POST ${url}/v1/chat`);
  console.error("Shell only — brain is Orchestrator (CLI still default for CI).");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
