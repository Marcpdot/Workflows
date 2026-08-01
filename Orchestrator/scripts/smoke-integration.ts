/**
 * Smoke for Milestone 5 integration contract (CLI JSON + workspace + HTTP health).
 */

import { spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { listenIntegrationServer } from "../src/integration/index.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function runCli(args: string[]): Promise<{
  code: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    // Invoke tsx via node (avoids Windows spawn EINVAL on npx.cmd)
    const tsxCli = resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs");
    const child = spawn(
      process.execPath,
      [tsxCli, "src/index.ts", ...args],
      {
        cwd: resolve(process.cwd()),
        env: { ...process.env },
        windowsHide: true,
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => {
      stdout += c;
    });
    child.stderr.on("data", (c) => {
      stderr += c;
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code, stdout, stderr }));
  });
}

async function main(): Promise<void> {
  // 1. --json --route-only → parseable pure JSON
  const route = await runCli([
    "--json",
    "--route-only",
    "Oppsummer denne teksten kort",
  ]);
  assert(route.code === 0, `route-only exit ${route.code}: ${route.stderr}`);
  const trimmed = route.stdout.trim();
  assert(trimmed.startsWith("{"), "stdout must be pure JSON object");
  const routing = JSON.parse(trimmed) as { model?: string };
  assert(routing.model === "local", `expected local, got ${routing.model}`);
  console.log("OK: --json --route-only pure JSON");

  // 2. --workspace binds tools
  const tmp = resolve(process.cwd(), "data", `_m5_ws_${Date.now()}`);
  mkdirSync(tmp, { recursive: true });
  writeFileSync(join(tmp, "marker.txt"), "workspace-marker\n", "utf8");

  try {
    const listed = await runCli([
      "--json",
      "--workspace",
      tmp,
      "--tool",
      "run",
      "list_dir",
      "path=.",
    ]);
    assert(listed.code === 0, `list_dir failed: ${listed.stderr}\n${listed.stdout}`);
    assert(
      listed.stdout.includes("marker.txt"),
      "workspace list_dir should see marker.txt"
    );

    const escape = await runCli([
      "--json",
      "--workspace",
      tmp,
      "--tool",
      "run",
      "read_file",
      "path=../package.json",
    ]);
    assert(escape.code !== 0, "escape should non-zero exit");
    const errText = `${escape.stdout}\n${escape.stderr}`.toLowerCase();
    assert(
      errText.includes("escape") || errText.includes("ok"),
      "escape should report error"
    );
    console.log("OK: --workspace binds tools");
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  // 3. HTTP /health
  const { server, url } = await listenIntegrationServer({
    host: "127.0.0.1",
    port: 18787,
  });
  try {
    const res = await fetch(`${url}/health`);
    const body = (await res.json()) as { ok?: boolean; service?: string };
    assert(res.status === 200 && body.ok === true, "health ok");
    assert(body.service === "orchestrator", "service name");
    console.log(`OK: HTTP GET /health (${url})`);

    const miss = await fetch(`${url}/nope`);
    assert(miss.status === 404, "404 unknown path");
    console.log("OK: HTTP 404");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }

  assert(
    existsSync(resolve(process.cwd(), "src/integration/contract.md")),
    "contract.md missing"
  );
  console.log("OK: contract.md present");

  console.log("All integration smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
