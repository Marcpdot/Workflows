ALTER TABLE knowledge_evidence RENAME COLUMN claim_node_id TO target_node_id;
ALTER INDEX knowledge_evidence_claim_idx RENAME TO knowledge_evidence_target_idx;

CREATE TABLE knowledge_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_node_id uuid NOT NULL REFERENCES knowledge_nodes(id),
  source_event_id uuid REFERENCES knowledge_events(id),
  source_node_id uuid REFERENCES knowledge_nodes(id),
  kind text NOT NULL CHECK (kind IN ('mentions', 'observes', 'independently_formulated', 'references')),
  observed_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  CHECK (source_event_id IS NOT NULL OR source_node_id IS NOT NULL)
);
CREATE INDEX knowledge_observations_target_time_idx ON knowledge_observations (target_node_id, observed_at);
CREATE INDEX knowledge_observations_event_idx ON knowledge_observations (source_event_id);
CREATE INDEX knowledge_observations_source_idx ON knowledge_observations (source_node_id);

-- Historical mentions are occurrences, not evidentiary claims.
INSERT INTO knowledge_observations (id, target_node_id, source_event_id, source_node_id, kind, observed_at, metadata)
SELECT id, target_node_id, source_event_id, source_node_id, 'mentions', created_at,
       jsonb_strip_nulls(jsonb_build_object('excerpt', excerpt, 'confidence', confidence))
FROM knowledge_evidence
WHERE stance = 'mentions';
DELETE FROM knowledge_evidence WHERE stance = 'mentions';

DO $$
DECLARE constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'knowledge_evidence'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%stance%mentions%'
  LOOP
    EXECUTE format('ALTER TABLE knowledge_evidence DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END
$$;
ALTER TABLE knowledge_evidence ADD CONSTRAINT knowledge_evidence_stance_check
  CHECK (stance IN ('supports', 'contradicts', 'test_evidence'));

ALTER TABLE knowledge_proposals DROP CONSTRAINT knowledge_proposals_kind_check;
ALTER TABLE knowledge_proposals ADD CONSTRAINT knowledge_proposals_kind_check
  CHECK (kind IN ('node', 'edge', 'evidence', 'observation'));
