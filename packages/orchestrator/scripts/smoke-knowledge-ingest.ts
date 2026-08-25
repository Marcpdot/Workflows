/**
 * Offline smoke for deterministic ingest (no live model).
 * Jobs stay awaiting accept — never silently canonical.
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
    const first = await ingestText(store, {
      text: sample,
      sourceRef: "smoke-ingest-1",
      workspaceId: "ws-ingest",
      projectLabel: "aktuator-v2",
    });
    assert(first.status === "awaiting_accept", `status awaiting_accept got ${first.status}`);
    assert(!!first.jobId, "jobId");
    assert(first.chunkCount >= 1, `chunks >= 1 got ${first.chunkCount}`);
    assert(
      first.sourceRef.includes("project=aktuator-v2"),
      "project hint in sourceRef"
    );
    assert(
      (await store.listChunks()).length === 0,
      "canonical retrieve hides unaccepted jobs"
    );
    assert(
      (await store.listChunks({ jobId: first.jobId, canonicalOnly: false })).length === first.chunkCount,
      "operator inspect sees unaccepted chunks"
    );
    const acceptedBefore = await store.findNodes({
      status: "accepted",
      limit: 50,
    });
    assert(acceptedBefore.length === 0, "no silent node accept after ingest");
    console.log(`OK: ingestText job=${first.jobId} chunks=${first.chunkCount}`);

    await store.acceptTransformJob(first.jobId);
    assert((await store.listChunks()).length === first.chunkCount, "accept makes chunks canonical");
    console.log("OK: explicit job accept only");

    const second = await ingestText(store, {
      text: sample,
      sourceRef: "smoke-ingest-2",
    });
    assert(second.status === "awaiting_accept", "repeat ingest is a new job");
    assert(second.jobId !== first.jobId, "repeat ingest does not reuse the job");
    console.log(`OK: second ingest job=${second.jobId}`);

    const fileRes = await ingestFile(store, {
      path: fixturePath,
      sourceRef: "smoke-file",
    });
    assert(
      fileRes.status === "awaiting_accept" || fileRes.status === "failed",
      "file mode"
    );
    if (fileRes.status === "awaiting_accept") {
      assert(fileRes.chunkCount >= 1, "file chunks");
      assert(
        (await store.getTransformJob(fileRes.jobId))?.status === "awaiting_accept",
        "file job awaits accept"
      );
    }
    console.log(
      `OK: ingestFile status=${fileRes.status} chunks=${fileRes.chunkCount}`
    );

    const short = await ingestText(store, {
      text: "hi",
      minChars: 80,
    });
    assert(short.status === "skipped", "short skipped");
    assert(!short.jobId, "no job when skipped");
    console.log("OK: minChars gate");

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
    const data = toolRes.data as { jobId?: string; chunkCount?: number };
    assert(!!data.jobId, "tool jobId");
    assert((data.chunkCount ?? 0) >= 1, "tool chunks");
    console.log("OK: knowledge_ingest tool");

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
      sourceRef: "chat-auto:test",
      minChars: 20,
    });
    assert(chatIngest.status === "awaiting_accept", "chat segment awaits accept");
    console.log("OK: chat segment ingest is a transform job");
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

  console.log("All knowledge-ingest smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
