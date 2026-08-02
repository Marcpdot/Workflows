/**
 * Offline smoke for Milestone 11 knowledge shell (no live model).
 */

import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyExtractionResult,
  createKnowledgeStore,
  type ExtractionResult,
} from "@workflows/knowledge";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const dbPath = resolve(
    process.cwd(),
    "data",
    `_smoke_knowledge_${Date.now()}.db`
  );

  const fixture: ExtractionResult = {
    concepts: [
      { label: "copper loss", description: "I2R heating in windings" },
      { label: "heat", description: "thermal energy" },
      { label: "continuous torque", description: "sustained motor torque" },
    ],
    claims: [
      {
        label: "copper loss produces heat",
        description: "resistive losses convert to thermal energy",
        confidence: 0.9,
      },
    ],
    relations: [
      {
        from: "copper loss",
        relation: "increases",
        to: "heat",
        confidence: 0.9,
      },
      {
        from: "heat",
        relation: "limits",
        to: "continuous torque",
        confidence: 0.85,
      },
    ],
    evidence: [
      {
        claimLabel: "copper loss produces heat",
        excerpt: "Copper losses produce heat in the windings.",
        stance: "supports",
      },
    ],
  };

  const store = createKnowledgeStore({ dbPath });
  try {
    // 1. createEvent + addProposals from fixture
    const { eventId, proposals } = await applyExtractionResult(
      store,
      fixture,
      {
        sourceType: "manual",
        sourceRef: "smoke-fixture",
        model: "fixture",
        rawText: "Copper losses produce heat that limits continuous torque.",
      }
    );
    assert(!!eventId, "eventId");
    assert(proposals.length >= 6, `expected proposals, got ${proposals.length}`);
    console.log(`OK: event + ${proposals.length} proposals`);

    // 2. list pending
    const pending = await store.listProposals({ status: "pending" });
    assert(pending.length === proposals.length, "all pending");
    console.log("OK: listProposals pending");

    // 3. accept concepts (order: nodes first)
    const nodeProps = pending.filter((p) => p.kind === "node");
    for (const p of nodeProps) {
      await store.acceptProposal(p.id);
    }
    const copper = (await store.findNodes({
      type: "concept",
      label: "copper loss",
      status: "accepted",
    }))[0];
    assert(!!copper, "copper loss concept accepted");
    assert(copper!.status === "accepted", "status accepted");
    console.log("OK: accept concept → findNodes");

    // 4. accept edges
    const edgeProps = pending.filter((p) => p.kind === "edge");
    for (const p of edgeProps) {
      await store.acceptProposal(p.id);
    }
    const neigh = await store.getNeighborhood(copper!.id, {
      hops: 2,
      status: "accepted",
    });
    assert(neigh.nodes.length >= 2, `neighborhood nodes ${neigh.nodes.length}`);
    assert(neigh.edges.length >= 1, `neighborhood edges ${neigh.edges.length}`);
    const labels = new Set(neigh.nodes.map((n) => n.label.toLowerCase()));
    assert(labels.has("copper loss"), "has copper loss");
    assert(labels.has("heat"), "has heat");
    console.log(
      `OK: neighborhood hops=2 nodes=${neigh.nodes.length} edges=${neigh.edges.length}`
    );

    // 5. reject one leftover (if any still pending)
    const still = await store.listProposals({ status: "pending" });
    if (still.length > 0) {
      await store.rejectProposal(still[0]!.id);
      const rejected = await store.listProposals({ status: "rejected" });
      assert(rejected.some((p) => p.id === still[0]!.id), "rejected listed");
      console.log("OK: rejectProposal");
    } else {
      // reject a synthetic extra then ensure it is not in neighborhood
      const { proposals: extra } = await applyExtractionResult(
        store,
        {
          concepts: [{ label: "noise-node-should-reject" }],
          claims: [],
          relations: [],
        },
        { sourceType: "manual", sourceRef: "reject-test" }
      );
      await store.rejectProposal(extra[0]!.id);
      const noise = await store.findNodes({
        label: "noise-node-should-reject",
        status: "accepted",
      });
      assert(noise.length === 0, "rejected concept not accepted");
      console.log("OK: rejectProposal (extra proposal)");
    }

    // 6. identity: accepting same concept again reuses (via second accept path)
    const { proposals: dup } = await applyExtractionResult(
      store,
      {
        concepts: [{ label: "copper loss", description: "dup" }],
        claims: [],
        relations: [],
      },
      { sourceType: "manual", sourceRef: "dup-test" }
    );
    await store.acceptProposal(dup[0]!.id);
    const copperNodes = await store.findNodes({
      type: "concept",
      label: "copper loss",
      status: "accepted",
    });
    assert(copperNodes.length === 1, "identity: single copper loss node");
    console.log("OK: label+type identity reuse");

    console.log("All knowledge (M11) smoke checks passed.");
  } finally {
    store.close();
    try {
      if (existsSync(dbPath)) rmSync(dbPath);
      for (const suffix of ["-shm", "-wal"]) {
        const p = dbPath + suffix;
        if (existsSync(p)) rmSync(p);
      }
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
