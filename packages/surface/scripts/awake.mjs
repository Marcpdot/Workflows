/**
 * Wake path: knowledge compose → orchestrator serve → surface dev.
 * Surface remains an HTTP client of http://127.0.0.1:8787.
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const surfaceRoot = resolve(here, "..");
const repoRoot = resolve(surfaceRoot, "../..");
const orchRoot = resolve(repoRoot, "packages/orchestrator");
const children = [];

function run(command, args, cwd, env = {}) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
    shell: process.platform === "win32",
    windowsHide: true,
  });
  children.push(child);
  return child;
}

function shutdown() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* ignore */
    }
  }
}

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

console.error("1. knowledge docker compose…");
const compose = run(
  "docker",
  ["compose", "-f", "compose.knowledge.yml", "up", "--detach", "--wait"],
  repoRoot
);

compose.on("exit", (code) => {
  if (code !== 0) {
    console.error(
      "Knowledge compose did not start. Maps will be empty until Postgres is up."
    );
  }
  console.error("2. orchestrator serve on 127.0.0.1:8787 (KNOWLEDGE_HTTP_READ=true)…");
  const serve = run(
    "npm",
    ["run", "serve"],
    orchRoot,
    { KNOWLEDGE_HTTP_READ: "true" }
  );
  serve.on("error", (err) => {
    console.error(err instanceof Error ? err.message : err);
  });
  setTimeout(() => {
    console.error("3. work surface at http://127.0.0.1:5173 …");
    const vite = run("npm", ["run", "dev"], surfaceRoot);
    vite.on("exit", (viteCode) => {
      shutdown();
      process.exit(viteCode ?? 0);
    });
  }, 1500);
});
