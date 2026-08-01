/**
 * Offline smoke for Milestone 2 phase A tools.
 *
 * 1. list_dir on workspace
 * 2. read_file package.json
 * 3. run_command git status (or skip if not git)
 * 4. path escape → expected error
 * 5. non-whitelist command → expected error
 */

import { resolve } from "node:path";
import {
  createBuiltinRegistry,
  resolveSafePath,
} from "@workflows/tools";

async function main(): Promise<void> {
  // Workspace for tools: Orchestrator package root (has package.json)
  const workspaceRoot = resolve(process.cwd());
  const registry = createBuiltinRegistry();
  const ctx = { workspaceRoot };

  const names = registry.list().map((t) => t.name);
  for (const required of ["read_file", "list_dir", "run_command"]) {
    if (!names.includes(required)) {
      throw new Error(`Missing built-in tool: ${required}`);
    }
  }
  console.log(`OK: registry has ${names.join(", ")}`);

  // 1. list_dir
  const listed = await registry.execute("list_dir", { path: "." }, ctx);
  if (!listed.ok) throw new Error(`list_dir failed: ${listed.error}`);
  if (!listed.output.toLowerCase().includes("package.json")) {
    throw new Error("list_dir should include package.json");
  }
  console.log("OK: list_dir");

  // 2. read_file
  const read = await registry.execute(
    "read_file",
    { path: "package.json" },
    ctx
  );
  if (!read.ok) throw new Error(`read_file failed: ${read.error}`);
  if (!read.output.includes('"name"')) {
    throw new Error("read_file package.json missing name field text");
  }
  console.log("OK: read_file package.json");

  // 3. run_command git status
  const git = await registry.execute(
    "run_command",
    { command: "git status" },
    ctx
  );
  if (git.ok) {
    console.log("OK: run_command git status");
  } else {
    console.log(`SKIP: git status (${git.error})`);
  }

  // 4. path escape
  let escapeThrew = false;
  try {
    resolveSafePath(workspaceRoot, "../secret.txt");
  } catch {
    escapeThrew = true;
  }
  if (!escapeThrew) {
    throw new Error("resolveSafePath should reject ../ escape");
  }

  const escapeTool = await registry.execute(
    "read_file",
    { path: "../../etc/passwd" },
    ctx
  );
  if (escapeTool.ok) {
    throw new Error("read_file should fail on path escape");
  }
  console.log(`OK: path escape blocked (${escapeTool.error})`);

  // 5. non-whitelist command
  const bad = await registry.execute(
    "run_command",
    { command: "rm -rf /" },
    ctx
  );
  if (bad.ok) {
    throw new Error("non-whitelist command should fail");
  }
  if (!bad.error?.toLowerCase().includes("whitelist")) {
    throw new Error(`expected whitelist error, got: ${bad.error}`);
  }
  console.log("OK: non-whitelist command blocked");

  // git push blocked
  const push = await registry.execute(
    "run_command",
    { command: "git push" },
    ctx
  );
  if (push.ok) {
    throw new Error("git push should be blocked in phase A");
  }
  console.log("OK: git push blocked");

  // unknown tool
  const unknown = await registry.execute("nope", {}, ctx);
  if (unknown.ok) throw new Error("unknown tool should fail");
  console.log("OK: unknown tool fails safely");

  console.log("All tools smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
