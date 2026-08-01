/**
 * Smoke for M6 web UI: server serves index + health (no model required).
 */

import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { listenIntegrationServer } from "../src/integration/httpServer.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const publicDir = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "../src/ui/web/public"
  );
  assert(existsSync(resolve(publicDir, "index.html")), "index.html missing");
  assert(existsSync(resolve(publicDir, "app.js")), "app.js missing");
  assert(existsSync(resolve(publicDir, "styles.css")), "styles.css missing");
  console.log("OK: static assets present");

  const { server, url } = await listenIntegrationServer({
    host: "127.0.0.1",
    port: 18788,
    staticDir: publicDir,
  });

  try {
    const health = await fetch(`${url}/health`);
    const h = (await health.json()) as { ok?: boolean };
    assert(health.status === 200 && h.ok === true, "health");
    console.log("OK: /health");

    const page = await fetch(`${url}/`);
    const html = await page.text();
    assert(page.status === 200, `index status ${page.status}`);
    assert(html.includes("Orchestrator"), "index should mention Orchestrator");
    assert(html.includes("app.js"), "index should load app.js");
    console.log("OK: GET / serves UI");

    const css = await fetch(`${url}/styles.css`);
    assert(css.status === 200, "styles.css");
    const js = await fetch(`${url}/app.js`);
    assert(js.status === 200, "app.js");
    console.log("OK: static css/js");

    // API still on same origin
    const bad = await fetch(`${url}/v1/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert(bad.status === 400, "chat without prompt → 400");
    console.log("OK: /v1/chat validation still works");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log("All UI smoke checks passed.");
  console.log("(Manual: npm run ui — send a message; CLI unchanged.)");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
