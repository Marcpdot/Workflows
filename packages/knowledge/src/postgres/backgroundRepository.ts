import type { Pool, PoolClient } from "pg";
import type {
  KnowledgeBackgroundWork,
  KnowledgeBackgroundWorkKind,
  KnowledgeTransformation,
} from "../types.js";
import type { BackgroundWorkPersistence } from "../backgroundCognition.js";

function millis(value: Date | string | number): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function work(row: Record<string, unknown>): KnowledgeBackgroundWork {
  return {
    id: String(row.id),
    kind: row.kind as KnowledgeBackgroundWorkKind,
    workKey: String(row.work_key),
    sourceExperienceId: row.source_experience_id == null ? undefined : String(row.source_experience_id),
    sourceEventId: row.source_event_id == null ? undefined : String(row.source_event_id),
    targetProposalId: row.target_proposal_id == null ? undefined : String(row.target_proposal_id),
    targetNodeId: row.target_node_id == null ? undefined : String(row.target_node_id),
    payload: object(row.payload),
    status: row.status as KnowledgeBackgroundWork["status"],
    attemptCount: Number(row.attempt_count),
    availableAt: millis(row.available_at as Date),
    completedAt: row.completed_at == null ? undefined : millis(row.completed_at as Date),
    escalatedAt: row.escalated_at == null ? undefined : millis(row.escalated_at as Date),
    lastError: row.last_error == null ? undefined : String(row.last_error),
    createdAt: millis(row.created_at as Date),
    updatedAt: millis(row.updated_at as Date),
  };
}

export class PostgresBackgroundWorkRepository implements BackgroundWorkPersistence {
  constructor(private readonly pool: Pool) {}

  async withExclusivePass<T>(run: () => Promise<T>): Promise<T | null> {
    const client: PoolClient = await this.pool.connect();
    const lockId = 8_214_701_936;
    let locked = false;
    try {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock($1) AS locked",
        [lockId]
      );
      locked = result.rows[0]?.locked === true;
      return locked ? await run() : null;
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock($1)", [lockId]);
      client.release();
    }
  }

  async listAvailable(limit: number): Promise<KnowledgeBackgroundWork[]> {
    const result = await this.pool.query(
      `SELECT * FROM knowledge_background_work
       WHERE status = 'pending' AND available_at <= now()
       ORDER BY available_at ASC, created_at ASC, id ASC
       LIMIT $1`,
      [Math.min(Math.max(Math.floor(limit), 1), 1_000)]
    );
    return result.rows.map(work);
  }

  async hasSemanticProposalsForExperience(experienceId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1
       FROM knowledge_events AS event
       JOIN knowledge_proposals AS proposal ON proposal.event_id = event.id
       WHERE event.action_metadata->'sourceExperienceIds' ? $1
         AND proposal.kind IN ('node', 'edge', 'evidence', 'observation', 'supersede')
       LIMIT 1`,
      [experienceId]
    );
    return result.rows.length > 0;
  }

  async ensureEvent(input: {
    work: KnowledgeBackgroundWork;
    sourceType: "conversation" | "file" | "project" | "manual";
    sourceExperienceIds: string[];
    transformation: KnowledgeTransformation;
  }): Promise<string> {
    const sourceRef = `background:${input.work.kind}:${input.work.id}`;
    const metadata = JSON.stringify({
      sourceExperienceIds: [...new Set(input.sourceExperienceIds)],
      transformation: input.transformation,
      backgroundWorkId: input.work.id,
    });
    const inserted = await this.pool.query<{ id: string }>(
      `INSERT INTO knowledge_events
         (source_type, source_ref, action_metadata)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (source_ref) WHERE source_ref LIKE 'background:%'
       DO NOTHING
       RETURNING id::text`,
      [input.sourceType, sourceRef, metadata]
    );
    if (inserted.rows[0]) return inserted.rows[0].id;
    const existing = await this.pool.query<{ id: string }>(
      "SELECT id::text FROM knowledge_events WHERE source_ref = $1",
      [sourceRef]
    );
    if (!existing.rows[0]) throw new Error(`background event ${sourceRef} could not be recovered`);
    return existing.rows[0].id;
  }

  async complete(id: string, payloadPatch: Record<string, unknown> = {}): Promise<void> {
    await this.pool.query(
      `UPDATE knowledge_background_work
       SET status = 'completed', completed_at = COALESCE(completed_at, now()),
           escalated_at = NULL, last_error = NULL, updated_at = now(),
           payload = payload || $2::jsonb
       WHERE id = $1 AND status IN ('pending', 'waiting')`,
      [id, JSON.stringify(payloadPatch)]
    );
  }

  async wait(id: string, payloadPatch: Record<string, unknown> = {}): Promise<void> {
    await this.pool.query(
      `UPDATE knowledge_background_work
       SET status = 'waiting', available_at = now(), last_error = NULL,
           updated_at = now(), payload = payload || $2::jsonb
       WHERE id = $1 AND status = 'pending'`,
      [id, JSON.stringify(payloadPatch)]
    );
  }

  async escalate(id: string, payloadPatch: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `UPDATE knowledge_background_work
       SET status = 'escalated', escalated_at = COALESCE(escalated_at, now()),
           completed_at = NULL, last_error = NULL, updated_at = now(),
           payload = payload || $2::jsonb
       WHERE id = $1 AND status IN ('pending', 'waiting')`,
      [id, JSON.stringify(payloadPatch)]
    );
  }

  async fail(input: {
    id: string;
    error: string;
    maxRetries: number;
    retryDelayMs: number;
  }): Promise<"retry" | "escalated"> {
    const result = await this.pool.query<{ status: "pending" | "escalated" }>(
      `UPDATE knowledge_background_work
       SET attempt_count = attempt_count + 1,
           status = CASE WHEN attempt_count + 1 >= $3 THEN 'escalated' ELSE 'pending' END,
           available_at = CASE
             WHEN attempt_count + 1 >= $3 THEN available_at
             ELSE now() + ($4::double precision * interval '1 millisecond')
           END,
           escalated_at = CASE WHEN attempt_count + 1 >= $3 THEN now() ELSE NULL END,
           completed_at = NULL,
           last_error = $2,
           updated_at = now()
       WHERE id = $1 AND status = 'pending'
       RETURNING status`,
      [input.id, input.error.slice(0, 2_000), input.maxRetries, input.retryDelayMs]
    );
    return result.rows[0]?.status === "escalated" ? "escalated" : "retry";
  }
}

export function createPostgresBackgroundWorkRepository(
  pool: Pool
): PostgresBackgroundWorkRepository {
  return new PostgresBackgroundWorkRepository(pool);
}
