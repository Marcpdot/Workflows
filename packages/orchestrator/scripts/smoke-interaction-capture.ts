/**
 * Offline smoke: interaction mode + continuous capture (no live model).
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createMemory } from "@workflows/memory";
import {
  captureConversationSegment,
  createKnowledgeStore,
} from "@workflows/knowledge";
import { tryHandleSessionCommand } from "../src/sessionCommands.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const dataDir = resolve(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const stamp = Date.now();
  const memPath = resolve(dataDir, `_smoke_sess_${stamp}.db`);
  const knowPath = resolve(dataDir, `_smoke_know_cap_${stamp}.db`);

  const memory = createMemory({ dbPath: memPath });
  const knowledge = createKnowledgeStore({ dbPath: knowPath });
  const sessionId = "ws:test:smoke-capture";

  try {
    // 1. default session state is active
    const st0 = await memory.getSessionState(sessionId);
    assert(st0.interactionMode === "active", "default active");
    assert(st0.proposalsEnabled === true, "default proposals on");
    console.log("OK: default session state active");

    // 2. /mode neutral persists
    const cmd = await tryHandleSessionCommand("/mode neutral", {
      memory,
      sessionId,
      knowledge,
    });
    assert(cmd.kind === "handled", "mode handled");
    const st1 = await memory.getSessionState(sessionId);
    assert(st1.interactionMode === "neutral", "persisted neutral");
    console.log("OK: /mode neutral persists");

    await tryHandleSessionCommand("/mode active", {
      memory,
      sessionId,
      knowledge,
    });

    // 3. captureConversationSegment produces pending only
    const cap = await captureConversationSegment({
      store: knowledge,
      sessionId,
      force: true,
      minUserMessageLength: 10,
      maxProposalsPerTurn: 8,
      messages: [
        {
          role: "user",
          content:
            "Copper losses produce heat that limits continuous torque under sustained load.",
        },
        {
          role: "assistant",
          content:
            "Yes — heat is a contingent limit tied to insulation class; absolute magnetic limits also apply.",
        },
      ],
    });
    assert(cap.proposals.length >= 1, "proposals created");
    assert(
      cap.proposals.every((p) => p.status === "pending"),
      "all pending"
    );
    assert(cap.summaries.length === cap.proposals.length, "summaries");
    console.log(
      `OK: capture segment proposals=${cap.proposals.length} mode=${cap.mode}`
    );

    // 4. accept via command
    const id = cap.proposals[0]!.id;
    const acc = await tryHandleSessionCommand(`/accept ${id}`, {
      memory,
      sessionId,
      knowledge,
    });
    assert(acc.kind === "handled", "accept handled");
    const still = await knowledge.listProposals({ status: "pending" });
    assert(!still.some((p) => p.id === id), "accepted removed from pending");
    console.log("OK: /accept removes from pending");

    // 5. proposals off
    await tryHandleSessionCommand("/proposals off", {
      memory,
      sessionId,
      knowledge,
    });
    const st2 = await memory.getSessionState(sessionId);
    assert(st2.proposalsEnabled === false, "proposals off");
    console.log("OK: /proposals off");

    // 6. short message skip without force
    const skip = await captureConversationSegment({
      store: knowledge,
      sessionId,
      force: false,
      minUserMessageLength: 40,
      messages: [{ role: "user", content: "hi" }],
    });
    assert(skip.mode === "skipped", "short skipped");
    console.log("OK: substance heuristic skips short messages");
  } finally {
    memory.close();
    knowledge.close();
    for (const p of [memPath, knowPath]) {
      try {
        if (existsSync(p)) rmSync(p);
        for (const s of ["-shm", "-wal"]) {
          if (existsSync(p + s)) rmSync(p + s);
        }
      } catch {
        /* ignore */
      }
    }
  }

  console.log("All interaction-capture smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
