-- Lifecycle acceptance is not epistemic certainty. Keep the two dimensions
-- independent and reuse generic observations for explicit derivation links.
ALTER TABLE knowledge_nodes
  ADD COLUMN epistemic_status text NOT NULL DEFAULT 'unknown'
  CHECK (epistemic_status IN (
    'observed', 'supported', 'inferred', 'hypothesized',
    'assumed', 'established', 'unknown'
  ));

-- Preserve the actual source alongside its stable reference/hash. Structured
-- transformation details and source experience UUIDs live in the existing
-- action_metadata JSON document instead of a second event model.
ALTER TABLE knowledge_events
  ADD COLUMN source_content text,
  ADD COLUMN invalidated_at timestamptz,
  ADD COLUMN invalidation_reason text,
  ADD CONSTRAINT knowledge_events_invalidation_check
    CHECK ((invalidated_at IS NULL) = (invalidation_reason IS NULL));

ALTER TABLE knowledge_observations
  DROP CONSTRAINT knowledge_observations_kind_check;
ALTER TABLE knowledge_observations
  ADD CONSTRAINT knowledge_observations_kind_check
  CHECK (kind IN (
    'mentions', 'observes', 'independently_formulated', 'references',
    'derived_from'
  ));

CREATE INDEX knowledge_observations_derivation_source_idx
  ON knowledge_observations (source_node_id, target_node_id)
  WHERE kind = 'derived_from';
CREATE INDEX knowledge_observations_derivation_event_idx
  ON knowledge_observations (source_event_id, target_node_id)
  WHERE kind = 'derived_from';
