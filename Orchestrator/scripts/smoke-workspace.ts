/**
 * Offline smoke for Milestone 9 session / workspace model.
 * No models required.
 */

import {
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { createMemory } from "@workflows/memory";
import { resolveSafePath } from "../src/tools/pathSafety.js";
import {
  resolveProjectContextDir,
  resolveProjectLongTermDbPath,
  resolveWorkspace,
  workspaceIdFromRoot,
} from "../src/workspace/index.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const base = resolve(process.cwd(), "data", `_m9_ws_${Date.now()}`);
  const wsA = join(base, "project-a");
  const wsB = join(base, "project-b");
  mkdirSync(join(wsA, "context"), { recursive: true });
  mkdirSync(wsB, { recursive: true });
  writeFileSync(join(wsA, "context", "notes.md"), "# Project A notes\n", "utf8");
  writeFileSync(join(wsA, "marker.txt"), "a\n", "utf8");
  writeFileSync(join(wsB, "marker.txt"), "b\n", "utf8");

  const dbPath = join(base, "memory.db");

  try {
    // 1. Distinct workspace ids
    const idA = workspaceIdFromRoot(wsA);
    const idB = workspaceIdFromRoot(wsB);
    assert(idA !== idB, "different roots → different ids");
    assert(idA === workspaceIdFromRoot(wsA), "id is stable");
    console.log("OK: workspace ids stable and distinct");

    // 2. Session namespace: same logical id, different storage keys
    const ctxA = resolveWorkspace({
      workspaceRoot: wsA,
      sessionId: "default",
      cwd: process.cwd(),
      env: {},
    });
    const ctxB = resolveWorkspace({
      workspaceRoot: wsB,
      sessionId: "default",
      cwd: process.cwd(),
      env: {},
    });
    assert(ctxA.logicalSessionId === "default", "logical A");
    assert(ctxB.logicalSessionId === "default", "logical B");
    assert(ctxA.sessionId !== ctxB.sessionId, "effective sessions isolated");
    assert(ctxA.sessionId.startsWith(`ws:${ctxA.id}:`), "prefix A");
    assert(ctxB.sessionId.startsWith(`ws:${ctxB.id}:`), "prefix B");
    assert(ctxA.rootPath === resolve(wsA), "root A");
    console.log("OK: session namespace per workspace");

    // 3. Short-term histories do not mix
    const mem = createMemory({ dbPath });
    await mem.add(ctxA.sessionId, {
      role: "user",
      content: "hello from A",
    });
    await mem.add(ctxA.sessionId, {
      role: "assistant",
      content: "hi A",
    });
    await mem.add(ctxB.sessionId, {
      role: "user",
      content: "hello from B",
    });

    const histA = await mem.getHistory(ctxA.sessionId);
    const histB = await mem.getHistory(ctxB.sessionId);
    assert(histA.length === 2, `A history expected 2, got ${histA.length}`);
    assert(histB.length === 1, `B history expected 1, got ${histB.length}`);
    assert(
      histA.some((m) => m.content.includes("from A")),
      "A content"
    );
    assert(
      !histB.some((m) => m.content.includes("from A")),
      "B must not see A"
    );

    const listedA = await mem.listSessions(ctxA.sessionPrefix);
    assert(
      listedA.includes(ctxA.sessionId),
      "listSessions sees A under prefix"
    );
    assert(
      !listedA.includes(ctxB.sessionId),
      "listSessions A prefix excludes B"
    );
    mem.close();
    console.log("OK: short-term histories isolated + listSessions");

    // 4. Project context prefers workspace/context
    const ctxDirA = resolveProjectContextDir({
      rootPath: resolve(wsA),
      env: {},
      cwd: process.cwd(),
    });
    assert(
      ctxDirA === resolve(wsA, "context"),
      `expected workspace context, got ${ctxDirA}`
    );
    const ctxDirB = resolveProjectContextDir({
      rootPath: resolve(wsB),
      env: {},
      cwd: process.cwd(),
    });
    // B has no context/ → falls back to default layout (still a string path)
    assert(typeof ctxDirB === "string" && ctxDirB.length > 0, "fallback B");
    assert(
      ctxDirB !== resolve(wsB, "context") || existsSync(ctxDirB),
      "B context resolution"
    );
    console.log("OK: project context per workspace");

    // 5. Tools cannot escape workspace root
    let escaped = false;
    try {
      resolveSafePath(wsA, "../package.json");
    } catch (err) {
      escaped =
        err instanceof Error &&
        err.message.toLowerCase().includes("escape");
    }
    assert(escaped, "path escape rejected");
    const safe = resolveSafePath(wsA, "marker.txt");
    assert(safe === resolve(wsA, "marker.txt"), "safe path under root");
    console.log("OK: tools bound to workspace root (no escape)");

    // 6. SESSION_NAMESPACE=false → legacy logical id only
    const legacy = resolveWorkspace({
      workspaceRoot: wsA,
      sessionId: "default",
      env: { SESSION_NAMESPACE: "false" },
    });
    assert(legacy.sessionId === "default", "legacy session id");
    assert(legacy.sessionPrefix === "", "legacy prefix empty");
    console.log("OK: SESSION_NAMESPACE=false legacy mode");

    // 7. Optional project-scoped LTM path
    const noProject = resolveProjectLongTermDbPath(wsA, {});
    assert(noProject === null, "project LTM off by default");
    const projectDb = resolveProjectLongTermDbPath(wsA, {
      LONGTERM_PROJECT_SCOPED: "true",
    });
    assert(
      projectDb === resolve(wsA, ".orchestrator/longterm.db"),
      `project LTM path, got ${projectDb}`
    );
    console.log("OK: optional project-scoped LTM path");

    console.log("All M9 workspace smokes passed.");
  } finally {
    try {
      rmSync(base, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
