-- Narrow, knowledge-owned progress ledger for finite background passes. This is
-- not a general scheduler: raw inputs remain in durable experience storage and
-- graph/vector work remains in the projection outbox.
CREATE TABLE knowledge_background_work (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN (
    'semantic_consolidation',
    'representation_gap_retry',
    'claim_reconsideration'
  )),
  work_key text NOT NULL UNIQUE,
  source_experience_id text,
  source_event_id uuid REFERENCES knowledge_events(id),
  target_proposal_id uuid REFERENCES knowledge_proposals(id),
  target_node_id uuid REFERENCES knowledge_nodes(id),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'waiting', 'completed', 'escalated'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  escalated_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'completed') = (completed_at IS NOT NULL)),
  CHECK ((status = 'escalated') = (escalated_at IS NOT NULL))
);

CREATE INDEX knowledge_background_work_pending_idx
  ON knowledge_background_work (available_at, created_at, id)
  WHERE status = 'pending';

CREATE INDEX knowledge_background_work_target_proposal_idx
  ON knowledge_background_work (target_proposal_id)
  WHERE target_proposal_id IS NOT NULL;

-- A worker-created event is stable across crash/retry. The event still carries
-- only experience IDs when a durable source exists.
CREATE UNIQUE INDEX knowledge_events_background_source_ref_idx
  ON knowledge_events (source_ref)
  WHERE source_ref LIKE 'background:%';
