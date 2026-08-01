/**
 * Entry: npm run serve
 * Thin HTTP on 127.0.0.1 — see contract.md
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { listenIntegrationServer } from "./httpServer.js";

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
  const port = Number(process.env.INTEGRATION_HTTP_PORT ?? 8787);
  const { url } = await listenIntegrationServer({
    host: "127.0.0.1",
    port,
    token: process.env.INTEGRATION_HTTP_TOKEN,
  });
  console.error(`Orchestrator integration HTTP listening on ${url}`);
  console.error(`  GET  ${url}/health`);
  console.error(`  POST ${url}/v1/chat`);
  if (process.env.INTEGRATION_HTTP_TOKEN) {
    console.error("  Auth: Authorization: Bearer <INTEGRATION_HTTP_TOKEN>");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
