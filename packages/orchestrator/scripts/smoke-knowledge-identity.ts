/**
 * Offline smoke for Milestone 15 identity / merge / contradiction.
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  createKnowledgeStore,
  createKnowledgeTools,
  normalizeLabel,
} from "@workflows/knowledge";
import { MapToolRegistry } from "@workflows/tools";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const dataDir = resolve(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = resolve(
    dataDir,
    `_smoke_knowledge_identity_${Date.now()}.db`
  );

  const store = createKnowledgeStore({ dbPath });

  try {
    assert(normalizeLabel("  Heat  ") === "heat", "normalizeLabel");
    assert(normalizeLabel("café") === "cafe", "diacritics strip");

    // Seed two concept nodes + edges via ensure-style accept path
    const event = await store.createEvent({
      sourceType: "manual",
      sourceRef: "smoke-m15",
    });
    const props = await store.addProposals(event.id, [
      { kind: "node", payload: { type: "concept", label: "heat" } },
      { kind: "node", payload: { type: "concept", label: "thermal energy" } },
      { kind: "node", payload: { type: "concept", label: "continuous torque" } },
      {
        kind: "edge",
        payload: { from: "thermal energy", relation: "limits", to: "continuous torque" },
      },
      {
        kind: "node",
        payload: {
          type: "claim",
          label: "heat increases continuous torque",
        },
      },
      {
        kind: "node",
        payload: {
          type: "claim",
          label: "heat limits continuous torque",
        },
      },
    ]);
    for (const p of props) {
      await store.acceptProposal(p.id);
    }

    const heat = (
      await store.findNodes({ type: "concept", label: "heat", status: "accepted" })
    )[0]!;
    const thermal = (
      await store.findNodes({
        type: "concept",
        label: "thermal energy",
        status: "accepted",
      })
    )[0]!;
    const torque = (
      await store.findNodes({
        type: "concept",
        label: "continuous torque",
        status: "accepted",
      })
    )[0]!;
    assert(!!heat && !!thermal && !!torque, "seed nodes");

    // Alias thermal energy → heat, then resolve
    const alias = await store.addAlias({
      aliasLabel: "Thermal  Energy",
      canonicalNodeId: heat.id,
    });
    assert(alias.aliasLabel === "thermal energy", "normalized alias");
    const resolved = await store.resolveCanonical({
      label: "thermal energy",
      type: "concept",
    });
    // Note: thermal energy is still its own accepted node; alias points heat
    // for the label "thermal energy" — wait, normalize of thermal energy equals
    // thermal's own label. Alias was set to heat, so resolve returns heat.
    assert(resolved?.id === heat.id, "resolve via alias → heat");
    console.log("OK: addAlias + resolveCanonical");

    // Merge thermal into heat: rewire limits edge onto heat
    const merge = await store.mergeNodes({
      fromId: thermal.id,
      intoId: heat.id,
    });
    assert(merge.from.status === "rejected", "from rejected");
    assert(merge.into.id === heat.id, "into survives");
    const neigh = await store.getNeighborhood(heat.id, {
      hops: 1,
      status: "accepted",
    });
    const hasLimits = neigh.edges.some(
      (e) =>
        e.relation === "limits" &&
        (e.fromNodeId === heat.id || e.toNodeId === heat.id)
    );
    assert(hasLimits, "limits edge rewired to heat");
    // Rejected node still exists (no hard delete)
    const old = await store.getNode(thermal.id);
    assert(old?.status === "rejected", "history kept as rejected");
    console.log(
      `OK: mergeNodes edgesRewired=${merge.edgesRewired} aliasCreated=${merge.aliasCreated}`
    );

    // Accept path avoids trivial duplicate (normalized)
    const ev2 = await store.createEvent({
      sourceType: "manual",
      sourceRef: "smoke-dup",
    });
    const [dupProp] = await store.addProposals(ev2.id, [
      { kind: "node", payload: { type: "concept", label: "  HEAT " } },
    ]);
    await store.acceptProposal(dupProp!.id);
    const heats = (
      await store.findNodes({ type: "concept", status: "accepted", limit: 50 })
    ).filter((n) => n.label.toLowerCase() === "heat" || n.label === "  HEAT ");
    // materialize should reuse heat, not create second accepted "  HEAT "
    const acceptedHeatLabels = (
      await store.findNodes({ type: "concept", status: "accepted", limit: 50 })
    ).filter((n) => n.label.trim().toLowerCase() === "heat");
    assert(acceptedHeatLabels.length === 1, "no trivial duplicate heat node");
    console.log("OK: accept reuses normalized identity");

    // Contradictions
    const claims = await store.findNodes({
      type: "claim",
      status: "accepted",
      limit: 10,
    });
    const c1 = claims.find((c) => c.label.includes("increases"))!;
    const c2 = claims.find((c) => c.label.includes("limits"))!;
    assert(!!c1 && !!c2, "two claims");
    await store.markContradiction({ fromId: c1.id, toId: c2.id });
    const pairs = await store.findContradictions();
    assert(pairs.length >= 1, "contradictions listed");
    assert(
      pairs.some((p) => p.summary.includes("contradicts")),
      "summary shape"
    );
    console.log("OK: markContradiction + findContradictions");

    // Supersede
    const superEdge = await store.supersedeClaim({
      oldClaimId: c1.id,
      newClaimId: c2.id,
    });
    assert(superEdge.relation === "supersedes", "supersedes edge");
    const oldClaim = await store.getNode(c1.id);
    assert(oldClaim?.status === "disputed", "old claim disputed, not deleted");
    console.log("OK: supersedeClaim keeps history");

    // Tools
    const registry = new MapToolRegistry();
    for (const t of createKnowledgeTools(store)) {
      registry.register(t);
    }
    for (const n of [
      "knowledge_merge",
      "knowledge_add_alias",
      "knowledge_find_contradictions",
      "knowledge_mark_contradiction",
      "knowledge_supersede",
    ]) {
      assert(
        registry.list().some((t) => t.name === n),
        `missing tool ${n}`
      );
    }
    const toolPairs = await registry.execute(
      "knowledge_find_contradictions",
      {},
      { workspaceRoot: process.cwd() }
    );
    assert(toolPairs.ok, toolPairs.error ?? "find contradictions tool");
    console.log("OK: M15 knowledge tools");
  } finally {
    store.close();
    try {
      if (existsSync(dbPath)) rmSync(dbPath);
      for (const s of ["-shm", "-wal"]) {
        if (existsSync(dbPath + s)) rmSync(dbPath + s);
      }
    } catch {
      /* ignore */
    }
  }

  console.log("All knowledge-identity (M15) smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
