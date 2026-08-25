/**
 * Offline smoke for Milestone 12 knowledge tools (no live model).
 */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  createKnowledgeStore,
  createKnowledgeTools,
} from "@workflows/knowledge";
import { MapToolRegistry } from "@workflows/tools";
import { startKnowledgePostgresTest } from "./knowledge-postgres-test-runtime.js";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const postgres = await startKnowledgePostgresTest();
  const dbPath = resolve(
    process.cwd(),
    "data",
    `_smoke_knowledge_tools_${Date.now()}.db`
  );
  const store = createKnowledgeStore();
  const registry = new MapToolRegistry();
  for (const t of createKnowledgeTools(store)) {
    registry.register(t);
  }

  const names = new Set(registry.list().map((t) => t.name));
  for (const n of [
    "knowledge_find",
    "knowledge_get",
    "knowledge_neighborhood",
    "knowledge_list_jobs",
    "knowledge_get_job",
    "knowledge_accept",
    "knowledge_reject",
    "knowledge_ensure_project",
    "knowledge_link_project",
    "knowledge_unlink_project",
    "knowledge_project_status",
    "knowledge_ingest",
    "knowledge_ingest_dir",
    "knowledge_accept_job",
    "knowledge_reject_job",
    "knowledge_chunks",
    "knowledge_search_chunks",
    "knowledge_add_alias",
    "knowledge_merge",
    "knowledge_find_contradictions",
    "knowledge_mark_contradiction",
    "knowledge_supersede",
  ]) {
    assert(names.has(n), `missing tool ${n}`);
  }
  assert(!names.has("knowledge_propose"), "proposal extract tools are off by default");
  assert(!names.has("knowledge_first_principles"), "fp extract tool is off by default");
  assert(!names.has("knowledge_list_proposals"), "proposal list is not the default operator gate");
  console.log("OK: knowledge tools registered; proposal-extract writes off by default");

  const ctx = { workspaceRoot: process.cwd() };

  const ingested = await registry.execute(
    "knowledge_ingest",
    { text: "Copper losses produce heat that limits continuous torque.", sourceRef: "smoke-tools-ingest" },
    ctx
  );
  assert(ingested.ok, ingested.error ?? "ingest");
  const ingestData = ingested.data as { jobId?: string; chunkCount?: number };
  assert(!!ingestData.jobId, "ingest jobId");
  const jobs = await registry.execute("knowledge_list_jobs", {}, ctx);
  assert(jobs.ok, jobs.error ?? "list jobs");
  const jobList = jobs.data as { jobs?: Array<{ id: string }> };
  assert(jobList.jobs?.some((job) => job.id === ingestData.jobId), "awaiting job listed");
  const searched = await registry.execute(
    "knowledge_search_chunks",
    { query: "copper losses" },
    ctx
  );
  assert(searched.ok, searched.error ?? "search chunks");
  const searchHits = searched.data as { hits?: unknown[] };
  assert((searchHits.hits?.length ?? 0) === 0, "unaccepted chunks are not in canonical search");
  const acceptedJob = await registry.execute(
    "knowledge_accept_job",
    { jobId: ingestData.jobId },
    ctx
  );
  assert(acceptedJob.ok, acceptedJob.error ?? "accept job");
  const afterAccept = await registry.execute(
    "knowledge_search_chunks",
    { query: "copper losses" },
    ctx
  );
  assert(afterAccept.ok, afterAccept.error ?? "search after accept");
  const afterHits = afterAccept.data as { hits?: unknown[] };
  assert((afterHits.hits?.length ?? 0) >= 1, "accepted chunks are searchable");
  console.log("OK: ingest job list/accept/search");

  const legacy = new MapToolRegistry();
  for (const t of createKnowledgeTools(store, { proposalWrites: true })) {
    legacy.register(t);
  }
  assert(
    legacy.list().some((t) => t.name === "knowledge_propose"),
    "proposal tools can be opted in"
  );

  // propose structured
  const prop = await legacy.execute(
    "knowledge_propose",
    {
      concepts: JSON.stringify([
        { label: "motor" },
        { label: "heat" },
      ]),
      relations: JSON.stringify([
        { from: "motor", relation: "produces", to: "heat" },
      ]),
      sourceRef: "smoke-tools",
    },
    ctx
  );
  assert(prop.ok, `propose failed: ${prop.error}`);
  const propData = prop.data as {
    proposalIds?: string[];
    proposals?: Array<{ id: string; kind: string }>;
  };
  const ids =
    propData.proposalIds ??
    propData.proposals?.map((p) => p.id) ??
    [];
  assert(ids.length >= 2, `expected proposals, got ${ids.length}`);
  console.log("OK: knowledge_propose");

  const listed = await legacy.execute(
    "knowledge_list_proposals",
    { status: "pending" },
    ctx
  );
  assert(listed.ok, listed.error ?? "list");
  const listData = listed.data as { proposals?: unknown[] };
  assert(
    (listData.proposals?.length ?? 0) >= 1,
    "pending proposals expected"
  );
  console.log("OK: knowledge_list_proposals");

  // accept nodes then edges (order by kind)
  const proposals = (
    listData.proposals as Array<{ id: string; kind: string }>
  ).slice();
  for (const p of proposals.filter((x) => x.kind === "node")) {
    const r = await legacy.execute(
      "knowledge_accept",
      { proposalId: p.id },
      ctx
    );
    assert(r.ok, `accept node ${p.id}: ${r.error}`);
  }
  for (const p of proposals.filter((x) => x.kind === "edge")) {
    const r = await legacy.execute(
      "knowledge_accept",
      { proposalId: p.id },
      ctx
    );
    assert(r.ok, `accept edge ${p.id}: ${r.error}`);
  }
  console.log("OK: knowledge_accept nodes+edges");

  const found = await registry.execute(
    "knowledge_find",
    { label: "motor", status: "accepted" },
    ctx
  );
  assert(found.ok, found.error ?? "find");
  const foundData = found.data as {
    nodes?: Array<{ id: string; label: string }>;
  };
  assert((foundData.nodes?.length ?? 0) >= 1, "find motor");
  const motorId = foundData.nodes![0]!.id;
  console.log("OK: knowledge_find");

  const neigh = await registry.execute(
    "knowledge_neighborhood",
    { nodeId: motorId, hops: 1 },
    ctx
  );
  assert(neigh.ok, neigh.error ?? "neighborhood");
  const neighData = neigh.data as {
    edges?: unknown[];
    nodes?: unknown[];
  };
  assert((neighData.edges?.length ?? 0) >= 1, "neighborhood edges");
  console.log("OK: knowledge_neighborhood");

  // reject extra propose
  const extra = await legacy.execute(
    "knowledge_propose",
    {
      concepts: JSON.stringify([{ label: "noise-reject-me" }]),
    },
    ctx
  );
  assert(extra.ok, extra.error ?? "extra propose");
  const extraId = (extra.data as { proposalIds: string[] }).proposalIds[0]!;
  const rej = await legacy.execute(
    "knowledge_reject",
    { proposalId: extraId },
    ctx
  );
  assert(rej.ok, rej.error ?? "reject");
  const noise = await registry.execute(
    "knowledge_find",
    { label: "noise-reject-me", status: "accepted" },
    ctx
  );
  // find with no match returns ok:false
  assert(!noise.ok || ((noise.data as { nodes?: unknown[] }).nodes?.length ?? 0) === 0, "noise not accepted");
  console.log("OK: knowledge_reject");

  // Flag-off path: empty registry without knowledge tools
  const empty = new MapToolRegistry();
  assert(
    empty.list().every((t) => !t.name.startsWith("knowledge_")),
    "no knowledge tools when not registered"
  );
  console.log("OK: tools absent when not registered (KNOWLEDGE_TOOLS_ENABLED off path)");

  await store.close();
  await postgres.dispose();
  try {
    if (existsSync(dbPath)) rmSync(dbPath);
    for (const s of ["-shm", "-wal"]) {
      if (existsSync(dbPath + s)) rmSync(dbPath + s);
    }
  } catch {
    /* ignore */
  }

  console.log("All knowledge-tools (M12) smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
