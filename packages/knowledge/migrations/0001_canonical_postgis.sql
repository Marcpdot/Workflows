CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE knowledge_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type text NOT NULL CHECK (source_type IN ('conversation', 'file', 'project', 'manual')),
  source_ref text NOT NULL,
  model text,
  input_hash text,
  agent_id text,
  action_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('concept', 'claim', 'event', 'source', 'project', 'artifact')),
  label text NOT NULL,
  normalized_label text NOT NULL,
  description text,
  status text NOT NULL CHECK (status IN ('proposed', 'accepted', 'disputed', 'rejected')),
  workspace_id text,
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);
CREATE INDEX knowledge_nodes_type_status_idx ON knowledge_nodes (type, status);
CREATE INDEX knowledge_nodes_workspace_status_idx ON knowledge_nodes (workspace_id, status);
CREATE INDEX knowledge_nodes_normalized_label_idx ON knowledge_nodes (normalized_label);
CREATE UNIQUE INDEX knowledge_nodes_accepted_identity_idx
  ON knowledge_nodes (type, normalized_label, COALESCE(workspace_id, ''))
  WHERE status = 'accepted';

CREATE TABLE knowledge_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node_id uuid NOT NULL REFERENCES knowledge_nodes(id),
  relation text NOT NULL,
  to_node_id uuid NOT NULL REFERENCES knowledge_nodes(id),
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  source_event_id uuid REFERENCES knowledge_events(id),
  status text NOT NULL CHECK (status IN ('proposed', 'accepted', 'disputed', 'rejected')),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  valid_from timestamptz,
  valid_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_node_id <> to_node_id),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from)
);
CREATE INDEX knowledge_edges_from_status_idx ON knowledge_edges (from_node_id, status);
CREATE INDEX knowledge_edges_to_status_idx ON knowledge_edges (to_node_id, status);
CREATE INDEX knowledge_edges_relation_status_idx ON knowledge_edges (relation, status);
CREATE UNIQUE INDEX knowledge_edges_accepted_identity_idx
  ON knowledge_edges (from_node_id, relation, to_node_id)
  WHERE status = 'accepted';

CREATE TABLE knowledge_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_node_id uuid NOT NULL REFERENCES knowledge_nodes(id),
  source_node_id uuid NOT NULL REFERENCES knowledge_nodes(id),
  source_event_id uuid REFERENCES knowledge_events(id),
  excerpt text,
  stance text NOT NULL CHECK (stance IN ('supports', 'contradicts', 'mentions')),
  confidence double precision CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_evidence_claim_idx ON knowledge_evidence (claim_node_id);
CREATE INDEX knowledge_evidence_source_idx ON knowledge_evidence (source_node_id);

CREATE TABLE knowledge_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES knowledge_events(id),
  kind text NOT NULL CHECK (kind IN ('node', 'edge', 'evidence')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,
  CHECK ((status = 'pending') = (resolved_at IS NULL))
);
CREATE INDEX knowledge_proposals_status_created_idx ON knowledge_proposals (status, created_at);
CREATE INDEX knowledge_proposals_event_idx ON knowledge_proposals (event_id);

CREATE TABLE knowledge_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alias_label text NOT NULL,
  normalized_alias_label text NOT NULL,
  canonical_node_id uuid NOT NULL REFERENCES knowledge_nodes(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (normalized_alias_label)
);
CREATE INDEX knowledge_aliases_canonical_idx ON knowledge_aliases (canonical_node_id);

CREATE TABLE knowledge_locations (
  canonical_node_id uuid PRIMARY KEY REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  geometry geometry(Geometry, 4326) NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX knowledge_locations_geometry_gist_idx
  ON knowledge_locations USING gist (geometry);

CREATE TABLE knowledge_projection_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_id uuid NOT NULL,
  projection text NOT NULL CHECK (projection IN ('graph', 'vector')),
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete', 'rebuild')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  available_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  processed_at timestamptz,
  last_error text
);
CREATE INDEX knowledge_projection_outbox_pending_idx
  ON knowledge_projection_outbox (available_at, created_at)
  WHERE processed_at IS NULL;
