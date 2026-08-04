/**
 * Offline smoke: interaction mode + continuous capture iteration (no live model).
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { createMemory } from "@workflows/memory";
import {
  captureConversationSegment,
  conversationHeuristicExtract,
  createKnowledgeStore,
  isLowSubstanceUserMessage,
  listPendingForSession,
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

    // 3. conversation extract prefers structural relations
    const extracted = conversationHeuristicExtract(
      "user: Copper losses produce heat that limits continuous torque under sustained load.\n\n" +
        "assistant: Heat is a contingent technological limit (insulation); magnetic limits can be fundamental."
    );
    assert(extracted.relations.length >= 1, "structural relations");
    assert(
      extracted.relations.some(
        (r) =>
          r.relation === "causes" ||
          r.relation === "limits" ||
          r.relation === "produces"
      ) ||
        extracted.relations.some((r) =>
          ["causes", "limits"].includes(r.relation)
        ),
      "typed causal/limit edges"
    );
    assert(
      extracted.claims.some((c) =>
        String(c.description ?? "").includes("limitKind=")
      ) ||
        extracted.concepts.some((c) =>
          String(c.description ?? "").includes("limitKind=")
        ),
      "limitKind property"
    );
    console.log(
      `OK: conversation extract relations=${extracted.relations.length} claims=${extracted.claims.length}`
    );

    // 4. captureConversationSegment produces pending only
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
            "Yes — heat is a contingent technological limit tied to insulation class; absolute magnetic limits also apply.",
        },
      ],
    });
    assert(cap.proposals.length >= 1, "proposals created");
    assert(
      cap.proposals.every((p) => p.status === "pending"),
      "all pending"
    );
    assert(cap.summaries.length === cap.proposals.length, "summaries");
    const edgeKinds = cap.proposals
      .filter((p) => p.kind === "edge")
      .map((p) => String(p.payload.relation));
    assert(
      edgeKinds.some((r) =>
        ["causes", "limits", "requires", "increases", "reduces"].includes(r)
      ),
      `expected structural edge, got ${edgeKinds.join(",")}`
    );
    console.log(
      `OK: capture segment proposals=${cap.proposals.length} mode=${cap.mode} edges=${edgeKinds.join(",")}`
    );

    // 5. session-scoped pending queue
    const queue = await listPendingForSession(knowledge, sessionId);
    assert(queue.length >= 1, "session queue non-empty");
    assert(
      queue.every((s) => s.sourceRef?.startsWith(`conversation:${sessionId}`)),
      "sourceRef session scoped"
    );
    console.log(`OK: listPendingForSession count=${queue.length}`);

    // 6. second capture dedupes pending
    const cap2 = await captureConversationSegment({
      store: knowledge,
      sessionId,
      force: true,
      messages: [
        {
          role: "user",
          content:
            "Copper losses produce heat that limits continuous torque under sustained load.",
        },
      ],
    });
    assert(
      cap2.skippedDuplicateNodes >= 0,
      "dedupe field present"
    );
    // Should not explode queue with identical nodes
    const queue2 = await listPendingForSession(knowledge, sessionId);
    assert(
      queue2.length < queue.length + cap.proposals.length,
      "pending dedupe limits growth"
    );
    console.log(
      `OK: second capture skipped=${cap2.skippedDuplicateNodes} queue=${queue2.length}`
    );

    // 7. accept via command
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

    // 8. proposals off
    await tryHandleSessionCommand("/proposals off", {
      memory,
      sessionId,
      knowledge,
    });
    const st2 = await memory.getSessionState(sessionId);
    assert(st2.proposalsEnabled === false, "proposals off");
    console.log("OK: /proposals off");

    // 9. low substance skip
    assert(isLowSubstanceUserMessage("hi", 40), "hi low substance");
    assert(isLowSubstanceUserMessage("ok", 40), "ok low substance");
    const skip = await captureConversationSegment({
      store: knowledge,
      sessionId,
      force: false,
      minUserMessageLength: 40,
      messages: [{ role: "user", content: "hi" }],
    });
    assert(skip.mode === "skipped", "short skipped");
    console.log("OK: substance heuristic skips short messages");

    // 10. rate limit
    const rate = await captureConversationSegment({
      store: knowledge,
      sessionId,
      force: false,
      minIntervalMs: 60_000,
      lastExtractAt: Date.now(),
      minUserMessageLength: 10,
      messages: [
        {
          role: "user",
          content:
            "Bearing friction increases heat and limits continuous torque at high RPM.",
        },
      ],
    });
    assert(rate.mode === "skipped", "rate limited");
    assert(rate.reason?.includes("rate-limit"), "rate-limit reason");
    console.log("OK: rate-limit skips auto extract");
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

  console.log("All interaction-capture iteration smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
