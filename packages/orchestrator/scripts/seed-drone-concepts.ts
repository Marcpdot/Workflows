/**
 * Manual seed: 12 drone/thrust concepts + core edges → accept into knowledge.db.
 * No LLM. Writes to the real store (not a temp smoke DB).
 *
 *   cd packages/orchestrator
 *   npx tsx scripts/seed-drone-concepts.ts
 *
 * Optional:
 *   SEED_EDGES=0  — concepts only
 */

import {
  applyExtractionResult,
  createKnowledgeStore,
  resolvePostgresKnowledgeConfig,
  type ExtractionResult,
} from "@workflows/knowledge";

const CONCEPTS: ExtractionResult["concepts"] = [
  {
    label: "Thrust",
    description:
      "Force that lifts or accelerates the aircraft against gravity and drag",
  },
  {
    label: "Rotor",
    description:
      "Rotating aerodynamic surface that imparts momentum to air",
  },
  {
    label: "Actuator",
    description:
      "Device that converts energy into mechanical motion at the rotor",
  },
  {
    label: "Electric motor",
    description: "Electromagnetic actuator common in multirotors",
  },
  {
    label: "Battery",
    description: "Onboard electrochemical energy store",
  },
  {
    label: "Copper loss",
    description: "I2R heating in motor windings",
  },
  {
    label: "Heat",
    description: "Thermal energy that must be rejected from the motor or ESC",
  },
  {
    label: "Continuous torque",
    description: "Sustained torque without exceeding thermal limits",
  },
  {
    label: "Peak torque",
    description: "Short-duration torque above continuous rating",
  },
  {
    label: "Energy density",
    description: "Energy per unit mass of the battery (Wh/kg class)",
  },
  {
    label: "Hover power",
    description:
      "Power required to produce thrust equal to weight in steady hover",
  },
  {
    label: "Gravity",
    description: "Body force requiring continuous upward thrust in hover",
  },
];

const RELATIONS: ExtractionResult["relations"] = [
  { from: "Gravity", relation: "requires", to: "Thrust", confidence: 1 },
  { from: "Rotor", relation: "used_in", to: "Thrust", confidence: 0.9 },
  { from: "Actuator", relation: "controls", to: "Rotor", confidence: 0.9 },
  {
    from: "Electric motor",
    relation: "part_of",
    to: "Actuator",
    confidence: 0.85,
  },
  { from: "Copper loss", relation: "causes", to: "Heat", confidence: 0.95 },
  {
    from: "Heat",
    relation: "limits",
    to: "Continuous torque",
    confidence: 0.9,
  },
  {
    from: "Continuous torque",
    relation: "limits",
    to: "Thrust",
    confidence: 0.85,
  },
  {
    from: "Energy density",
    relation: "limits",
    to: "Hover power",
    confidence: 0.85,
  },
  {
    from: "Electric motor",
    relation: "causes",
    to: "Copper loss",
    confidence: 0.9,
  },
];

async function main(): Promise<void> {
  const seedEdges = process.env.SEED_EDGES !== "0";
  const postgres = resolvePostgresKnowledgeConfig();
  console.log(`Knowledge DB: ${new URL(postgres.connectionString).host}`);

  const fixture: ExtractionResult = {
    concepts: CONCEPTS,
    claims: [],
    relations: seedEdges ? RELATIONS : [],
  };

  const store = createKnowledgeStore({ postgresConfig: postgres });
  try {
    const { eventId, proposals } = await applyExtractionResult(store, fixture, {
      sourceType: "manual",
      sourceRef: "seed-drone-concepts",
      model: "manual-seed",
      rawText: "manual seed: drone thrust concepts and core edges",
    });

    console.log(`Event ${eventId}: ${proposals.length} proposals`);

    const nodes = proposals.filter((p) => p.kind === "node");
    const edges = proposals.filter((p) => p.kind === "edge");

    for (const p of nodes) {
      await store.acceptProposal(p.id);
      const label = String(p.payload.label ?? "?");
      console.log(`  accepted node: ${label}`);
    }
    for (const p of edges) {
      await store.acceptProposal(p.id);
      const from = String(p.payload.from ?? "?");
      const rel = String(p.payload.relation ?? "?");
      const to = String(p.payload.to ?? "?");
      console.log(`  accepted edge: ${from} -[${rel}]-> ${to}`);
    }

    const accepted = await store.findNodes({
      type: "concept",
      status: "accepted",
      limit: 50,
    });
    const labels = CONCEPTS.map((c) => c.label.toLowerCase());
    const found = accepted.filter((n) =>
      labels.includes(n.label.toLowerCase())
    );
    console.log(
      `Done. Matched ${found.length}/${CONCEPTS.length} seed concepts in accepted graph.`
    );
    console.log("Open Graph in the web UI and Refresh.");
  } finally {
    store.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
