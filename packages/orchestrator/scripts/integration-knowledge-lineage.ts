import {
  applyExtractionResult,
  createKnowledgePostgresPool,
  createKnowledgeReader,
  createKnowledgeStore,
  disposeIsolatedKnowledgeDatabase,
  endKnowledgePostgresPool,
  extractionToProposalItems,
  loadKnowledgeMigrations,
  normalizeStructuredCapture,
  resolvePostgresKnowledgeConfig,
  runKnowledgeMigrations,
} from "@workflows/knowledge";
import { emitCcEvaluationResult } from "@workflows/eval";
import { randomUUID } from "node:crypto";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function databaseUrl(source: string, database: string): string {
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

async function main(): Promise<void> {
  const evaluationStarted = performance.now();
  const base = resolvePostgresKnowledgeConfig();
  const database = `workflows_lineage_${randomUUID().replaceAll("-", "")}`;
  assert(/^workflows_lineage_[a-f0-9]+$/.test(database), "safe database name");
  const admin = createKnowledgePostgresPool({
    ...base,
    connectionString: databaseUrl(base.connectionString, "postgres"),
    applicationName: `${base.applicationName}-lineage-admin`,
  });
  let pool: ReturnType<typeof createKnowledgePostgresPool> | undefined;

  try {
    await admin.query(`CREATE DATABASE ${database}`);
    const config = {
      ...base,
      connectionString: databaseUrl(base.connectionString, database),
      applicationName: `${base.applicationName}-lineage`,
    };
    pool = createKnowledgePostgresPool(config);
    await runKnowledgeMigrations(pool, await loadKnowledgeMigrations(config.migrationsDir));
    const store = createKnowledgeStore({ postgresConfig: config, pool });
    const reader = createKnowledgeReader(store);

    const experienceIds = [randomUUID(), randomUUID()];
    const sourceContent = "User suspects thermal drift causes the observed offset; calibration stability is assumed.";
    const sourceEvent = await store.createEvent({
      sourceType: "conversation",
      sourceRef: "conversation:lineage-fixture",
      sourceContent,
      sourceExperienceIds: experienceIds,
      model: "fixture-extractor-v1",
      inputHash: "fixture-hash",
      transformation: {
        method: "conversation_structured_extraction",
        model: "fixture-extractor-v1",
        representationScope: "claims and explicit assumptions",
        informationLoss: {
          occurred: true,
          description: "Tone and unselected conversational context are omitted.",
        },
      },
    });
    assert(sourceEvent.sourceContent === undefined, "durable experiences take precedence over duplicate event source content");

    let databaseRejectedDuplicate = false;
    try {
      await pool.query(
        `INSERT INTO knowledge_events
           (source_type, source_ref, source_content, action_metadata)
         VALUES ('conversation', 'conversation:invalid-duplicate', 'duplicate', $1::jsonb)`,
        [JSON.stringify({ sourceExperienceIds: [randomUUID()] })]
      );
    } catch {
      databaseRejectedDuplicate = true;
    }
    assert(databaseRejectedDuplicate, "database prevents fallback content from coexisting with durable experience IDs");

    const extracted = await applyExtractionResult(
      store,
      { concepts: [{ label: "Experience-backed extraction fixture" }], claims: [], relations: [] },
      {
        sourceType: "conversation",
        sourceRef: "conversation:extraction-fixture",
        rawText: "This raw text already exists in a durable experience.",
        sourceExperienceIds: [experienceIds[0]!, " "],
      }
    );
    const extractedEvent = await store.getEvent(extracted.eventId);
    assert(extractedEvent?.sourceContent === undefined && extractedEvent.sourceExperienceIds.join(",") === experienceIds[0], "experience-backed extraction retains IDs without copying raw content");

    const unbackedText = "Calibration logs show that offset increases with measured temperature.";
    const unbackedEvent = await store.createEvent({
      sourceType: "file",
      sourceRef: "file:calibration-log.txt",
      sourceContent: unbackedText,
    });
    assert(unbackedEvent.sourceExperienceIds.length === 0 && unbackedEvent.sourceContent === unbackedText, "non-experience-backed events retain fallback source content");

    const assumptionProposal = (await store.addProposals(sourceEvent.id, [{
      kind: "node",
      payload: {
        type: "claim",
        label: "Calibration remains stable",
        epistemicStatus: "assumed",
        confidence: 0.6,
        observationKind: "derived_from",
        derivation: {
          method: "assumption_extraction",
          assumptions: ["Calibration stability is not independently verified"],
          representationScope: "explicit source assumption",
          informationLoss: { occurred: false },
        },
      },
    }]))[0]!;
    await store.acceptProposal(assumptionProposal.id);
    const assumption = (await store.findNodes({ type: "claim", label: "Calibration remains stable", status: "accepted" }))[0]!;

    const validFrom = Date.now() - 1_000;
    const validTo = Date.now() + 86_400_000;
    const claimProposal = (await store.addProposals(sourceEvent.id, [{
      kind: "node",
      payload: {
        type: "claim",
        label: "Thermal drift may cause the observed offset",
        epistemicStatus: "hypothesized",
        confidence: 0.42,
        validFrom,
        validTo,
        sourceNodeIds: [assumption.id],
        observationKind: "derived_from",
        derivation: {
          method: "model_summarization",
          model: "fixture-summarizer-v2",
          assumptions: ["Calibration remains stable"],
          confidence: 0.42,
          uncertainty: "Causal direction has not been experimentally tested.",
          representationScope: "causal hypothesis only",
          informationLoss: {
            occurred: true,
            description: "The summary omits conversational qualifiers outside the causal claim.",
          },
          validFrom,
          validTo,
        },
      },
    }]))[0]!;
    await store.acceptProposal(claimProposal.id);
    const claim = (await store.findNodes({ type: "claim", label: "Thermal drift may cause", status: "accepted" }))[0]!;
    assert(claim.status === "accepted" && claim.epistemicStatus === "hypothesized", "lifecycle acceptance does not upgrade epistemic status");
    assert(claim.confidence === 0.42 && claim.validFrom === validFrom && claim.validTo === validTo, "confidence and temporal validity survive materialization");

    const evidenceProposal = (await store.addProposals(sourceEvent.id, [{
      kind: "evidence",
      payload: {
        claimId: claim.id,
        sourceLabel: "thermal-log.csv",
        excerpt: "Offset rises with measured temperature in the sampled interval.",
        stance: "supports",
        confidence: 0.7,
      },
    }]))[0]!;
    await store.acceptProposal(evidenceProposal.id);

    const lineage = await reader.getClaimLineage(claim.id, { maxDepth: 8 });
    assert(lineage.claim.epistemicStatus === "hypothesized", "lineage exposes epistemic status");
    assert(lineage.sourceEvents.some((item) => item.id === sourceEvent.id && item.sourceRef === "conversation:lineage-fixture" && item.sourceContent === undefined), "experience-backed lineage preserves its source reference without a duplicate raw payload");
    assert(lineage.sourceEvents.some((item) => experienceIds.every((id) => item.sourceExperienceIds.includes(id))), "lineage reaches exact source experiences");
    assert(lineage.derivations.some((item) => item.method === "model_summarization" && item.model === "fixture-summarizer-v2"), "lineage exposes transformation method and model");
    assert(lineage.derivations.some((item) => item.assumptions?.includes("Calibration remains stable") && item.informationLoss?.occurred), "lineage exposes assumptions and information loss");
    assert(lineage.sourceNodes.some((item) => item.id === assumption.id && item.epistemicStatus === "assumed"), "lineage chains through canonical assumption claims");
    assert(lineage.evidence.some((item) => item.stance === "supports" && item.excerpt?.includes("Offset rises")), "lineage includes qualified evidence");

    const normalized = normalizeStructuredCapture({
      concepts: [],
      claims: [{
        label: "User suspects thermal drift causes the offset",
        epistemicStatus: "established",
      }],
      relations: [],
    });
    assert(normalized.extraction.claims[0]?.epistemicStatus === "hypothesized", "summarization cannot turn a reported suspicion into established state");
    const repeatedExtraction = extractionToProposalItems({
      concepts: [],
      claims: [{ label: "User suspects thermal drift causes the offset", epistemicStatus: "established" }],
      relations: [],
    });
    assert(repeatedExtraction[0]?.payload.epistemicStatus === "hypothesized", "every extraction path preserves suspicion as hypothesis");

    const invalidated = await store.invalidateEvent(sourceEvent.id, "Source segment was attributed to the wrong sensor run");
    assert(invalidated.invalidatedAt && invalidated.invalidationReason, "source event invalidation is explicit");
    const eventDependents = await reader.findDependentClaims({ sourceEventId: sourceEvent.id });
    assert(eventDependents.some((item) => item.claim.id === claim.id), "invalidated source exposes dependent claims");

    const replacementProposal = (await store.addProposals(sourceEvent.id, [{
      kind: "node",
      payload: {
        type: "claim",
        label: "Calibration stability requires revalidation",
        epistemicStatus: "supported",
      },
    }]))[0]!;
    await store.acceptProposal(replacementProposal.id);
    const replacement = (await store.findNodes({ type: "claim", label: "Calibration stability requires revalidation", status: "accepted" }))[0]!;
    await store.supersedeClaim({ oldClaimId: assumption.id, newClaimId: replacement.id });
    assert((await store.getNode(assumption.id))?.status === "disputed", "superseded assumption remains visible and disputed");
    const assumptionDependents = await reader.findDependentClaims({ sourceNodeId: assumption.id });
    assert(assumptionDependents.some((item) => item.claim.id === claim.id), "superseded assumption exposes dependent claims needing reconsideration");

    console.log("Epistemic status and transformation-lineage integration checks passed.");
    emitCcEvaluationResult({
      scenarioId: "wp2-lineage",
      pass: true,
      durationMs: Math.round(performance.now() - evaluationStarted),
      model: "fixture-summarizer-v2",
      provider: "local",
      provenanceChecks: {
        durableExperienceAuthoritative: true,
        exactSourceExperienceIds: true,
        unbackedSourceContentRetained: true,
        transformationLineageAuditable: true,
      },
      semanticChanges: {
        eventIds: [sourceEvent.id, extracted.eventId, unbackedIngest.eventId],
        proposalIds: [
          assumptionProposal.id,
          claimProposal.id,
          evidenceProposal.id,
          replacementProposal.id,
        ],
        canonicalIds: [assumption.id, claim.id, replacement.id],
      },
    });
  } finally {
    if (pool) await endKnowledgePostgresPool(pool);
    await disposeIsolatedKnowledgeDatabase(admin, database);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
