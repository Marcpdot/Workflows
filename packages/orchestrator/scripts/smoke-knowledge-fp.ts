/**
 * Offline smoke for Milestone 16 first-principles workflow (no live model).
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  createKnowledgeStore,
  createKnowledgeTools,
  firstPrinciplesToExtraction,
  heuristicFirstPrinciples,
  runFirstPrinciplesAnalysis,
  type FirstPrinciplesResult,
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
  const dbPath = resolve(dataDir, `_smoke_knowledge_fp_${Date.now()}.db`);
  const store = createKnowledgeStore();

  try {
    // 1. fixture shape
    const fixture: FirstPrinciplesResult = {
      goal: "Maximize continuous torque of motor under thermal limit",
      laws: [
        { label: "energy conservation", description: "P_in = P_out + losses" },
        { label: "Joule heating", description: "I^2 R copper loss" },
      ],
      limits: [
        {
          label: "material Curie temperature",
          kind: "absolute",
          description: "magnetic materials demagnetize",
        },
        {
          label: "winding insulation class",
          kind: "contingent",
          description: "depends on insulation choice",
        },
      ],
      bottlenecks: [
        {
          label: "copper loss heat",
          description: "dominant continuous-duty thermal load",
        },
      ],
      relations: [
        { from: "Joule heating", relation: "causes", to: "copper loss heat" },
        {
          from: "copper loss heat",
          relation: "limits",
          to: "continuous torque",
        },
        {
          from: "winding insulation class",
          relation: "limits",
          to: "copper loss heat",
        },
        {
          from: "energy conservation",
          relation: "requires",
          to: "continuous torque",
        },
      ],
      nextActions: [
        {
          label: "measure winding temperature vs torque",
          description: "validate thermal bottleneck",
        },
      ],
    };

    const extraction = firstPrinciplesToExtraction(
      fixture,
      "continuous torque"
    );
    assert(extraction.concepts.length >= 3, "concepts from fixture");
    assert(extraction.claims.length >= 1, "claims from fixture");
    assert(
      extraction.relations.some((r) => r.relation === "limits"),
      "limits relation"
    );
    assert(
      extraction.relations.some((r) => r.relation === "requires"),
      "requires relation"
    );
    assert(
      extraction.relations.some((r) => r.relation === "causes"),
      "causes relation"
    );
    console.log("OK: firstPrinciplesToExtraction relation types");

    // 2. runner with fixture → proposals only
    const run = await runFirstPrinciplesAnalysis({
      store,
      topic: "continuous torque",
      goal: fixture.goal,
      projectLabel: "aktuator-v2",
      fixture,
    });
    assert(run.mode === "fixture", "mode fixture");
    assert(!!run.eventId, "eventId");
    assert(run.proposals.length >= 5, `proposals got ${run.proposals.length}`);
    assert(
      run.proposals.every((p) => p.status === "pending"),
      "all pending"
    );
    assert(!!run.projectId, "project ensured");
    const edgeRels = run.proposals
      .filter((p) => p.kind === "edge")
      .map((p) => String(p.payload.relation));
    for (const need of ["limits", "requires", "causes", "used_in"]) {
      assert(edgeRels.includes(need), `expected edge relation ${need}`);
    }
    const accepted = await store.findNodes({ status: "accepted", limit: 50 });
    // project is accepted via ensureProject; analysis nodes still pending
    assert(
      accepted.every((n) => n.type === "project"),
      "no silent accept of analysis nodes"
    );
    console.log(
      `OK: runFirstPrinciplesAnalysis proposals=${run.proposals.length} project=${run.projectId}`
    );

    // 3. accept nodes then edges → neighborhood stable
    for (const p of run.proposals.filter((x) => x.kind === "node")) {
      await store.acceptProposal(p.id);
    }
    for (const p of run.proposals.filter((x) => x.kind === "edge")) {
      await store.acceptProposal(p.id);
    }
    const copperHits = await store.findNodes({
      type: "concept",
      label: "copper loss heat",
      status: "accepted",
      limit: 10,
    });
    const copper = copperHits.find(
      (n) => n.label.toLowerCase() === "copper loss heat"
    );
    assert(!!copper, "bottleneck concept accepted");
    const neigh = await store.getNeighborhood(copper!.id, {
      hops: 1,
      status: "accepted",
    });
    assert(
      neigh.edges.length >= 1,
      `neighborhood after accept (edges=${neigh.edges.length} nodes=${neigh.nodes.length})`
    );
    console.log("OK: accept path after FP proposals");

    // 4. heuristic offline (no fixture)
    const heur = heuristicFirstPrinciples("heat sink");
    assert(heur.laws.length >= 1 && heur.limits.length >= 2, "heuristic shape");
    const run2 = await runFirstPrinciplesAnalysis({
      store,
      topic: "heat sink",
    });
    assert(run2.mode === "heuristic", "heuristic mode");
    assert(run2.proposals.every((p) => p.status === "pending"), "still pending");
    console.log("OK: heuristic offline path");

    // 5. tool
    const registry = new MapToolRegistry();
    for (const t of createKnowledgeTools(store, { proposalWrites: true })) {
      registry.register(t);
    }
    assert(
      registry.list().some((t) => t.name === "knowledge_first_principles"),
      "tool registered"
    );
    const toolRes = await registry.execute(
      "knowledge_first_principles",
      { topic: "bearing friction", projectLabel: "aktuator-v2" },
      { workspaceRoot: process.cwd() }
    );
    assert(toolRes.ok, toolRes.error ?? "fp tool");
    const data = toolRes.data as { proposalIds?: string[]; mode?: string };
    assert((data.proposalIds?.length ?? 0) >= 1, "tool proposals");
    console.log("OK: knowledge_first_principles tool");
  } finally {
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
  }

  console.log("All knowledge-fp (M16) smoke checks passed.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
