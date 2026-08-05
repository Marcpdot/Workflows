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
  normalizeStructuredCapture,
} from "@workflows/knowledge";
import { tryHandleSessionCommand } from "../src/sessionCommands.js";
import { loadConfigFromEnv } from "../src/orchestrator.js";

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
    const remoteConfigured = loadConfigFromEnv(
      {
        XAI_API_KEY: "present-but-must-not-be-used-for-capture",
        KNOWLEDGE_CAPTURE_TIER: "frontier",
        KNOWLEDGE_CAPTURE_DISABLED: "true",
        LONGTERM_DISABLED: "true",
        TOOLS_DISABLED: "true",
      },
      { cwd: dataDir }
    );
    assert(
      remoteConfigured.knowledgeSettings?.captureModelTier === "local",
      "capture remains local even when frontier credentials/tier are present"
    );
    console.log("OK: capture model policy is local-only");

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

    // 4. quality boundary rejects questions, stutter, pseudo-edge labels and aliases relations
    const normalized = normalizeStructuredCapture({
      concepts: [
        { label: "heat" },
        { label: "How would heat change?" },
        { label: "heat -[causes]-> damage" },
        { label: "loss loss loss" },
      ],
      claims: [
        { label: "Copper loss increases winding temperature" },
        { label: "What if cooling improves?" },
      ],
      relations: [
        { from: "copper loss", relation: "produces", to: "heat" },
        { from: "heat", relation: "invented_relation", to: "torque" },
      ],
      openQuestions: ["Could another material help?"],
    });
    assert(normalized.extraction.concepts.length === 1, "junk concepts removed");
    assert(normalized.extraction.claims.length === 1, "question claims removed");
    assert(
      normalized.extraction.relations[0]?.relation === "causes",
      "relation alias normalized"
    );
    assert(normalized.dropped >= 5, "quality drops reported");
    console.log("OK: structured capture quality boundary");

    const structuredFixture = JSON.stringify({
      concepts: [
        { label: "copper loss" },
        { label: "heat" },
        { label: "continuous torque" },
      ],
      claims: [
        {
          label: "Copper loss increases winding temperature under sustained load",
          description: "limitKind=technological",
          confidence: 0.92,
        },
      ],
      relations: [
        { from: "copper loss", relation: "causes", to: "heat", confidence: 0.95 },
        { from: "heat", relation: "limits", to: "continuous torque", confidence: 0.9 },
      ],
      assumptions: [],
      openQuestions: ["How much cooling is enough?"],
    });

    // 5. schema-constrained model capture produces clean pending proposals only
    const cap = await captureConversationSegment({
      store: knowledge,
      sessionId,
      force: true,
      minUserMessageLength: 10,
      maxProposalsPerTurn: 8,
      model: "fixture-strong-model",
      complete: async () => structuredFixture,
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
    assert(cap.mode === "model", "structured model is primary path");
    assert(cap.droppedQualityItems >= 1, "open question dropped");
    assert(
      cap.proposals.every(
        (p) => !String(p.payload.label ?? "").trim().endsWith("?")
      ),
      "question-only proposals rejected"
    );
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

    // 6. session-scoped pending queue
    const queue = await listPendingForSession(knowledge, sessionId);
    assert(queue.length >= 1, "session queue non-empty");
    assert(
      queue.every((s) => s.sourceRef?.startsWith(`conversation:${sessionId}`)),
      "sourceRef session scoped"
    );
    console.log(`OK: listPendingForSession count=${queue.length}`);

    // 7. second identical structured capture dedupes pending
    const cap2 = await captureConversationSegment({
      store: knowledge,
      sessionId,
      force: true,
      model: "fixture-strong-model",
      complete: async () => structuredFixture,
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

    // 8. noisy structured result creates no graph debris
    const noisy = await captureConversationSegment({
      store: knowledge,
      sessionId: "ws:test:noisy",
      force: true,
      messages: [{ role: "user", content: "Hello, how would this work?" }],
      complete: async () =>
        JSON.stringify({
          concepts: [{ label: "hello" }, { label: "How would this work?" }],
          claims: [{ label: "What if what if what if?" }],
          relations: [
            { from: "hello", relation: "causes", to: "missing endpoint" },
          ],
          assumptions: [],
          openQuestions: ["How would this work?"],
        }),
    });
    assert(noisy.proposals.length === 0, "noisy segment creates no proposals");
    assert(noisy.droppedQualityItems >= 3, "noisy items counted as dropped");
    console.log("OK: noisy structured capture creates no proposals");

    // 9. model failure degrades to the quality-filtered heuristic path
    const fallback = await captureConversationSegment({
      store: knowledge,
      sessionId: "ws:test:fallback",
      force: true,
      messages: [
        {
          role: "user",
          content: "Bearing friction increases heat and heat limits continuous torque.",
        },
      ],
      complete: async () => {
        throw new Error("fixture model unavailable");
      },
    });
    assert(fallback.mode === "heuristic", "model error uses heuristic fallback");
    assert(fallback.reason?.includes("model fallback"), "fallback is visible");
    console.log("OK: model error falls back without breaking capture");

    // 10. accept via command
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

    // Accept remaining nodes before remaining edges, then verify accepted dedupe.
    for (const kind of ["node", "edge"] as const) {
      const pending = await knowledge.listProposals({ status: "pending" });
      for (const proposal of pending.filter((p) => p.kind === kind)) {
        await knowledge.acceptProposal(proposal.id);
      }
    }
    const acceptedDedupe = await captureConversationSegment({
      store: knowledge,
      sessionId: "ws:test:accepted-dedupe",
      force: true,
      messages: [
        {
          role: "user",
          content:
            "Copper losses produce heat that limits continuous torque under sustained load.",
        },
      ],
      model: "fixture-strong-model",
      complete: async () => structuredFixture,
    });
    assert(
      acceptedDedupe.proposals.length === 0,
      `accepted identity should suppress duplicates, got ${acceptedDedupe.proposals.length}`
    );
    console.log("OK: accepted nodes and edges dedupe structured capture");

    // 11. proposals off
    await tryHandleSessionCommand("/proposals off", {
      memory,
      sessionId,
      knowledge,
    });
    const st2 = await memory.getSessionState(sessionId);
    assert(st2.proposalsEnabled === false, "proposals off");
    console.log("OK: /proposals off");

    // 12. low substance skip
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

    // 13. rate limit
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
