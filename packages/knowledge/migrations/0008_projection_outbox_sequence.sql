ALTER TABLE knowledge_projection_outbox
  ADD COLUMN sequence_id bigint GENERATED ALWAYS AS IDENTITY;

CREATE UNIQUE INDEX knowledge_projection_outbox_sequence_idx
  ON knowledge_projection_outbox (sequence_id);

CREATE INDEX knowledge_projection_outbox_latest_pending_idx
  ON knowledge_projection_outbox (projection, canonical_id, sequence_id DESC)
  WHERE processed_at IS NULL;
