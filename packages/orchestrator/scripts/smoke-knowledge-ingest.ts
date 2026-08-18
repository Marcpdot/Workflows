/**
 * Offline smoke for Milestone 14 continuous/batch ingest (no live model).
 * Guarantees proposals only — never auto-accept.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createKnowledgeStore,
  createKnowledgeTools,
  formatChatSegment,
  ingestFile,
  ingestText,
} from "@workflows/knowledge";
import { MapToolRegistry } from "@workflows/tools";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const postgres = await startKnowledgePostgresTest();
  const dataDir = resolve(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(dataDir, `_smoke_knowledge_ingest_${Date.now()}.db`);
  const fixturePath = resolve(
    dataDir,
    `_smoke_ingest_fixture_${Date.now()}.md`
  );

  const sample = [
    "Copper losses produce heat in the motor windings.",
    "Heat limits continuous torque under sustained load.",
    "Thermal design requires adequate copper cross-section.",
  ].join(" ");

  writeFileSync(
    fixturePath,
    `# Notes\n\n${sample}\n\nSee also continuous torque budgeting.\n`,
    "utf8"
  );

  const store = createKnowledgeStore({
    defaultWorkspaceId: "ws-ingest",
  });

  try {
    // 1. ingest text → pending only
    const first = await ingestText(store, {
      text: sample,
      sourceType: "manual",
      sourceRef: "smoke-ingest-1",
      workspaceId: "ws-ingest",
      projectLabel: "aktuator-v2",
    });
    assert(first.mode === "heuristic", `mode heuristic got ${first.mode}`);
    assert(!!first.eventId, "eventId");
    assert(first.proposals.length >= 2, `proposals >= 2 got ${first.proposals.length}`);
    assert(
      first.proposals.every((p) => p.status === "pending"),
      "all pending"
    );
    assert(
      first.sourceRef.includes("project=aktuator-v2"),
      "project hint in sourceRef"
    );
    const acceptedBefore = await store.findNodes({
      status: "accepted",
      limit: 50,
    });
    assert(acceptedBefore.length === 0, "no silent accept after ingest");
    console.log(
      `OK: ingestText proposals=${first.proposals.length} skipped=${first.skippedDuplicateNodes}`
    );

    // 2. accept nodes once
    for (const p of first.proposals.filter((x) => x.kind === "node")) {
      await store.acceptProposal(p.id);
    }
    for (const p of first.proposals.filter((x) => x.kind === "edge")) {
      await store.acceptProposal(p.id);
    }
    const afterAccept = await store.findNodes({
      status: "accepted",
      limit: 50,
    });
    assert(afterAccept.length >= 1, "accepted after explicit accept");
    console.log("OK: explicit accept only");

    // 3. second ingest same content → fewer node proposals (dedupe)
    const second = await ingestText(store, {
      text: sample,
      sourceType: "manual",
      sourceRef: "smoke-ingest-2",
    });
    const nodeProps2 = second.proposals.filter((p) => p.kind === "node");
    assert(
      second.skippedDuplicateNodes === 0,
      "labels alone do not dedupe canonical identities"
    );
    assert(
      nodeProps2.length === first.proposals.filter((p) => p.kind === "node").length,
      "ambiguous repeated referents stay reviewable"
    );
    console.log(
      `OK: identity-safe second pass skipped=${second.skippedDuplicateNodes} nodeProposals=${nodeProps2.length}`
    );

    // 4. file ingest
    const fileRes = await ingestFile(store, {
      path: fixturePath,
      sourceRef: "smoke-file",
    });
    // file path absolute outside workspaceRoot is allowed for CLI-style (no root)
    assert(
      fileRes.mode === "heuristic" || fileRes.mode === "skipped",
      "file mode"
    );
    if (fileRes.mode === "heuristic") {
      assert(
        fileRes.proposals.every((p) => p.status === "pending"),
        "file proposals pending"
      );
    }
    console.log(
      `OK: ingestFile mode=${fileRes.mode} proposals=${fileRes.proposals.length}`
    );

    // 5. minChars skip
    const short = await ingestText(store, {
      text: "hi",
      minChars: 80,
    });
    assert(short.mode === "skipped", "short skipped");
    assert(short.proposals.length === 0, "no proposals when skipped");
    console.log("OK: minChars gate");

    // 6. tool knowledge_ingest
    const registry = new MapToolRegistry();
    for (const t of createKnowledgeTools(store)) {
      registry.register(t);
    }
    assert(
      registry.list().some((t) => t.name === "knowledge_ingest"),
      "knowledge_ingest registered"
    );
    const toolRes = await registry.execute(
      "knowledge_ingest",
      {
        text: "Bearing friction increases heat under high RPM continuous duty.",
        sourceRef: "tool-smoke",
      },
      { workspaceRoot: process.cwd() }
    );
    assert(toolRes.ok, toolRes.error ?? "tool ingest");
    const data = toolRes.data as { proposalIds?: string[] };
    assert((data.proposalIds?.length ?? 0) >= 1, "tool proposals");
    console.log("OK: knowledge_ingest tool");

    // 7. chat segment helper
    const segment = formatChatSegment(
      [
        { role: "user", content: "What limits continuous torque?" },
        { role: "assistant", content: "Heat from copper losses limits torque." },
      ],
      4
    );
    assert(segment.includes("user:"), "segment format");
    const chatIngest = await ingestText(store, {
      text: segment,
      sourceType: "conversation",
      sourceRef: "chat-auto:test",
      minChars: 20,
    });
    assert(
      chatIngest.proposals.every((p) => p.status === "pending"),
      "chat segment pending only"
    );
    console.log("OK: chat segment ingest proposals-only");
  } finally {
    await store.close();
    await postgres.dispose();
    for (const p of [dbPath, fixturePath]) {
      try {
        if (existsSync(p)) rmSync(p);
      } catch {
        /* ignore */
      }
    }
    for (const s of ["-shm", "-wal"]) {
      try {
        if (existsSync(dbPath + s)) rmSync(dbPath + s);
      } catch {
        /* ignore */
      }
    }
  }

  console.log("All knowledge-ingest (M14) smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
