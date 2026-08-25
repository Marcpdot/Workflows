import {
  acceptJob,
  chunkText,
  createKnowledgePostgresPool,
  createKnowledgeStore,
  createPostgresVectorRepository,
  disposeIsolatedKnowledgeDatabase,
  endKnowledgePostgresPool,
  ingestFile,
  ingestText,
  KNOWLEDGE_VECTOR_DIMENSION,
  loadKnowledgeMigrations,
  rejectJob,
  resolvePostgresKnowledgeConfig,
  runKnowledgeMigrations,
  semanticVectorRecordId,
  type SemanticEmbeddingProvider,
} from "@workflows/knowledge";
import { createHash, randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERT: ${message}`);
}

function databaseUrl(source: string, database: string): string {
  const url = new URL(source);
  url.pathname = `/${database}`;
  return url.toString();
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function fixtureEmbedder(fail = false): SemanticEmbeddingProvider {
  return {
    model: "fixture-ingest",
    modelVersion: "v1",
    dimension: KNOWLEDGE_VECTOR_DIMENSION,
    async embed(texts) {
      if (fail) throw new Error("fixture embedding failure");
      return texts.map((text) => {
        const vector = Array<number>(KNOWLEDGE_VECTOR_DIMENSION).fill(0);
        const index = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 32;
        vector[index] = 1;
        return vector;
      });
    },
  };
}

async function main(): Promise<void> {
  const sample = "Alpha paragraph one.\n\nBeta paragraph continues with extra words so windows overlap.";
  const firstWindows = chunkText(sample, { size: 28, overlap: 8 });
  const secondWindows = chunkText(sample, { size: 28, overlap: 8 });
  assert(firstWindows.length >= 2, "chunker splits long text");
  assert(
    JSON.stringify(firstWindows) === JSON.stringify(secondWindows),
    "chunker is deterministic"
  );
  assert(
    firstWindows[0]!.charStart === 0 && firstWindows[0]!.text === sample.slice(0, firstWindows[0]!.charEnd),
    "first chunk is a stable prefix"
  );
  assert(
    firstWindows.some((item, index) => index > 0 && item.charStart < firstWindows[index - 1]!.charEnd),
    "configured overlap is retained"
  );

  const base = resolvePostgresKnowledgeConfig();
  const database = `workflows_ingest_${randomUUID().replaceAll("-", "")}`;
  assert(/^workflows_ingest_[a-f0-9]+$/.test(database), "safe database name");
  const admin = createKnowledgePostgresPool({
    ...base,
    connectionString: databaseUrl(base.connectionString, "postgres"),
    applicationName: `${base.applicationName}-ingest-admin`,
  });
  let pool: ReturnType<typeof createKnowledgePostgresPool> | undefined;
  try {
    await admin.query(`CREATE DATABASE ${database}`);
    const config = {
      ...base,
      connectionString: databaseUrl(base.connectionString, database),
      applicationName: `${base.applicationName}-ingest`,
    };
    pool = createKnowledgePostgresPool(config);
    const migrations = await loadKnowledgeMigrations(config.migrationsDir);
    const applied = await runKnowledgeMigrations(pool, migrations);
    assert(applied.applied.includes("0013"), "transform job migration applies");
    const repository = createKnowledgeStore({ postgresConfig: config, pool });

    const text = "Copper losses produce heat. Heat limits continuous torque.";
    const job = await repository.putTransformJob({
      sourceKind: "markdown",
      sourcePath: "work/notes.md",
      sourceRef: "file:work/notes.md",
      workspaceId: "ws-ingest",
    });
    assert(job.status === "awaiting_accept", "new jobs await operator accept");
    assert(job.chunkCount === 0, "new jobs start with no chunks");

    const source = await repository.putAsIs({
      jobId: job.id,
      path: "work/notes.md",
      contentHash: hash(text),
      mediaType: "text/markdown",
      text,
      workspaceId: "ws-ingest",
    });
    assert(source.jobId === job.id, "as-is is bound to the transform job");
    assert(source.byteLength === Buffer.byteLength(text, "utf8"), "as-is preserves byte length");

    const first = text.indexOf("Copper");
    const second = text.indexOf("Heat");
    const chunks = await repository.putChunks([
      {
        jobId: job.id,
        asIsId: source.id,
        path: "work/notes.md",
        contentHash: hash(text.slice(0, second)),
        ordinal: 0,
        charStart: first,
        charEnd: second,
        text: text.slice(0, second),
        workspaceId: "ws-ingest",
      },
      {
        jobId: job.id,
        asIsId: source.id,
        path: "work/notes.md",
        contentHash: hash(text.slice(second)),
        ordinal: 1,
        charStart: second,
        charEnd: text.length,
        text: text.slice(second),
        workspaceId: "ws-ingest",
      },
    ]);
    assert(chunks.length === 2, "chunks persist with stable ordinals");
    assert((await repository.getTransformJob(job.id))?.chunkCount === 2, "job chunk_count tracks putChunks");
    assert((await repository.getAsIs(source.id))?.contentHash === source.contentHash, "getAsIs round-trips preserved source");
    assert((await repository.getAsIsForJob(job.id))?.id === source.id, "as-is is addressable by job");
    assert((await repository.getChunk(chunks[0]!.id))?.ordinal === 0, "chunks are addressable by id");

    const hidden = await repository.listChunks();
    assert(hidden.length === 0, "canonical retrieve excludes jobs awaiting accept");
    const pendingChunks = await repository.listChunks({ jobId: job.id, canonicalOnly: false });
    assert(pendingChunks.length === 2, "operator inspect can read unaccepted chunks");

    const accepted = await repository.acceptTransformJob(job.id);
    assert(accepted.status === "accepted" && accepted.resolvedAt, "accept is the canonical visibility gate");
    const visible = await repository.listChunks();
    assert(visible.length === 2, "accepted job chunks appear in canonical retrieve");
    assert(visible.every((item) => item.path.startsWith("work/")), "chunks retain source path");
    const byPrefix = await repository.listChunks({ pathPrefix: "work/" });
    assert(byPrefix.length === 2, "path prefix retrieve hits accepted chunks");
    assert((await repository.getNode(source.id))?.type === "source", "accepted as-is is a canonical source");
    assert((await repository.getNode(chunks[0]!.id))?.type === "chunk", "accepted chunk is a canonical node");

    const rejectedJob = await repository.putTransformJob({
      sourceKind: "text",
      sourcePath: "work/skip.md",
      sourceRef: "file:work/skip.md",
    });
    const rejectedAsIs = await repository.putAsIs({
      jobId: rejectedJob.id,
      path: "work/skip.md",
      contentHash: hash("skip"),
      mediaType: "text/markdown",
      text: "skip",
    });
    await repository.putChunks([
      {
        jobId: rejectedJob.id,
        asIsId: rejectedAsIs.id,
        path: "work/skip.md",
        contentHash: hash("skip"),
        ordinal: 0,
        charStart: 0,
        charEnd: 4,
        text: "skip",
      },
    ]);
    const rejected = await repository.rejectTransformJob(rejectedJob.id);
    assert(rejected.status === "rejected", "reject records the operator decision");
    assert((await repository.listChunks()).length === 2, "rejected jobs stay out of canonical retrieve");
    assert(
      (await repository.listChunks({ jobId: rejectedJob.id, canonicalOnly: false })).length === 1,
      "rejected material remains inspectable"
    );

    const failed = await repository.putTransformJob({
      status: "failed",
      sourceKind: "pdf",
      sourcePath: "work/scan.pdf",
      error: "PDF has no extractable text",
    });
    assert(failed.status === "failed" && failed.error, "failed jobs store an explicit reason");
    let failedAccept = false;
    try { await repository.acceptTransformJob(failed.id); } catch { failedAccept = true; }
    assert(failedAccept, "failed jobs cannot be accepted");

    let mutateAccepted = false;
    try {
      await repository.putAsIs({
        jobId: job.id,
        path: "work/notes.md",
        contentHash: hash(text),
        mediaType: "text/markdown",
        text,
      });
    } catch { mutateAccepted = true; }
    assert(mutateAccepted, "accepted jobs refuse further as-is mutation");

    let doubleAccept = false;
    try { await repository.acceptTransformJob(job.id); } catch { doubleAccept = true; }
    assert(doubleAccept, "accept is not repeatable");

    const listed = await repository.listTransformJobs({ status: "accepted" });
    assert(listed.some((item) => item.id === job.id), "jobs can be listed by status");

    const pipelineText = "Copper losses produce heat. Heat limits continuous torque under load.";
    const ingested = await ingestText(repository, {
      text: pipelineText,
      sourcePath: "work/notes.md",
      sourceRef: "file:work/notes.md",
      workspaceId: "ws-ingest",
    });
    assert(ingested.status === "awaiting_accept", "text ingest awaits accept");
    assert(ingested.chunkCount >= 1 && ingested.asIsId, "text ingest writes as-is and chunks");
    assert((await repository.listChunks()).every((item) => item.jobId !== ingested.jobId), "unaccepted ingest is hidden from canonical retrieve");
    const vectors = createPostgresVectorRepository({ ...config, pool });
    const embedder = fixtureEmbedder();
    const acceptedIngest = await acceptJob({
      store: repository,
      jobId: ingested.jobId,
      embedder,
      vector: vectors,
      pool,
    });
    assert(acceptedIngest.job.status === "accepted", "acceptJob accepts the transform job");
    assert((acceptedIngest.vector?.processed ?? 0) > 0, "acceptJob drains vector outbox with the embedding provider");
    assert(
      (await repository.listChunks({ pathPrefix: "work/notes.md" })).some((item) => item.jobId === ingested.jobId),
      "accepted ingest is visible to canonical retrieve"
    );
    const pipelineChunks = await repository.listChunks({ jobId: ingested.jobId });
    const embedded = await vectors.get(
      semanticVectorRecordId(pipelineChunks[0]!.id, embedder.model, embedder.modelVersion)
    );
    assert(embedded?.chunkId === pipelineChunks[0]!.id, "accepted chunk embeddings point at chunk ids");
    assert(embedded?.canonicalId === pipelineChunks[0]!.id, "chunk vector canonical id is the chunk");
    const query = (await embedder.embed([pipelineChunks[0]!.text]))[0]!;
    const hits = await vectors.search(query, {
      model: embedder.model,
      modelVersion: embedder.modelVersion,
      limit: 5,
    });
    assert(hits.some((hit) => hit.record.chunkId === pipelineChunks[0]!.id), "vector search can hit accepted chunks");

    const failingIngest = await ingestText(repository, {
      text: "A separate document used to prove embedding failure cannot un-accept a job.",
      sourcePath: "work/fail.md",
      sourceRef: "file:work/fail.md",
    });
    const failedEmbed = await acceptJob({
      store: repository,
      jobId: failingIngest.jobId,
      embedder: fixtureEmbedder(true),
      vector: vectors,
      pool,
    });
    assert(failedEmbed.job.status === "accepted", "embedding failure does not undo canonical accept");
    assert((failedEmbed.vector?.failed ?? 0) > 0, "failed embedding stays retryable on the outbox");

    const geoIngest = await ingestText(repository, {
      text: "Trondheim harbor crane sits at a known coordinate.",
      sourcePath: "work/geo.md",
      sourceRef: "file:work/geo.md",
    });
    await repository.acceptTransformJob(geoIngest.jobId, {
      geometry: { type: "Point", coordinates: [10.4, 63.43] },
    });
    const geoAsIs = await repository.getAsIsForJob(geoIngest.jobId);
    const location = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM knowledge_locations WHERE canonical_node_id = $1",
      [geoAsIs!.id]
    );
    assert(location.rows[0]?.count === "1", "geometry is stored only when supplied on accept");
    const noGeo = await ingestText(repository, {
      text: "Notes without coordinates still accept.",
      sourcePath: "work/nogeo.md",
      sourceRef: "file:work/nogeo.md",
    });
    await repository.acceptTransformJob(noGeo.jobId);
    assert((await repository.getTransformJob(noGeo.jobId))?.status === "accepted", "accept does not require geometry");

    const rejectable = await ingestText(repository, {
      text: "This job will be rejected by the operator.",
      sourcePath: "work/reject.md",
      sourceRef: "file:work/reject.md",
    });
    const rejectedPipeline = await rejectJob(repository, rejectable.jobId);
    assert(rejectedPipeline.status === "rejected", "rejectJob marks the transform job rejected");
    assert(
      (await repository.listChunks()).every((item) => item.jobId !== rejectable.jobId),
      "rejected jobs stay out of canonical retrieve"
    );

    const emptyPdfPath = join(tmpdir(), `workflows-empty-${randomUUID()}.pdf`);
    writeFileSync(
      emptyPdfPath,
      "%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n"
    );
    try {
      const emptyPdf = await ingestFile(repository, { path: emptyPdfPath, sourceRef: `file:${emptyPdfPath}` });
      assert(emptyPdf.status === "failed", "empty PDF becomes a failed job");
      assert(!!emptyPdf.reason, "empty PDF records an explicit error");
      assert((await repository.listChunks()).every((item) => item.jobId !== emptyPdf.jobId), "failed PDF is excluded from canonical retrieve");
    } finally {
      try { rmSync(emptyPdfPath); } catch { /* ignore */ }
    }

    console.log("Transform job persistence, ingest pipeline, and canonical-only retrieve checks passed.");
  } finally {
    if (pool) await endKnowledgePostgresPool(pool);
    await disposeIsolatedKnowledgeDatabase(admin, database);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
