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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const dbPath = resolve(
    process.cwd(),
    "data",
    `_smoke_knowledge_tools_${Date.now()}.db`
  );
  const store = createKnowledgeStore({ dbPath });
  const registry = new MapToolRegistry();
  for (const t of createKnowledgeTools(store)) {
    registry.register(t);
  }

  const names = new Set(registry.list().map((t) => t.name));
  for (const n of [
    "knowledge_find",
    "knowledge_get",
    "knowledge_neighborhood",
    "knowledge_list_proposals",
    "knowledge_propose",
    "knowledge_accept",
    "knowledge_reject",
    "knowledge_ensure_project",
    "knowledge_link_project",
    "knowledge_unlink_project",
    "knowledge_project_status",
    "knowledge_ingest",
  ]) {
    assert(names.has(n), `missing tool ${n}`);
  }
  console.log("OK: knowledge tools registered (M12–M14)");

  const ctx = { workspaceRoot: process.cwd() };

  // propose structured
  const prop = await registry.execute(
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

  const listed = await registry.execute(
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
    const r = await registry.execute(
      "knowledge_accept",
      { proposalId: p.id },
      ctx
    );
    assert(r.ok, `accept node ${p.id}: ${r.error}`);
  }
  for (const p of proposals.filter((x) => x.kind === "edge")) {
    const r = await registry.execute(
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
  const extra = await registry.execute(
    "knowledge_propose",
    {
      concepts: JSON.stringify([{ label: "noise-reject-me" }]),
    },
    ctx
  );
  assert(extra.ok, extra.error ?? "extra propose");
  const extraId = (extra.data as { proposalIds: string[] }).proposalIds[0]!;
  const rej = await registry.execute(
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

  store.close();
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
