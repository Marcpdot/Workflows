-- Rebuildable semantic projection. Canonical nodes remain authoritative.
CREATE TABLE knowledge_semantic_vectors (
  id uuid PRIMARY KEY,
  canonical_id uuid NOT NULL REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  source_id uuid REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  chunk_id uuid REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  embedding_model text NOT NULL,
  embedding_model_version text NOT NULL,
  embedding_dimension integer NOT NULL CHECK (embedding_dimension = 1536),
  workspace_id text,
  entity_type text,
  content_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (vector_dims(embedding) = embedding_dimension)
);

CREATE INDEX knowledge_semantic_vectors_canonical_idx
  ON knowledge_semantic_vectors (canonical_id);
CREATE INDEX knowledge_semantic_vectors_source_idx
  ON knowledge_semantic_vectors (source_id);
CREATE INDEX knowledge_semantic_vectors_chunk_idx
  ON knowledge_semantic_vectors (chunk_id);
CREATE INDEX knowledge_semantic_vectors_model_filter_idx
  ON knowledge_semantic_vectors (embedding_model, embedding_model_version, workspace_id, entity_type);
CREATE INDEX knowledge_semantic_vectors_metadata_gin_idx
  ON knowledge_semantic_vectors USING gin (metadata);

-- HNSW has strong query-time recall/latency without a training phase and is
-- appropriate for an incrementally maintained, rebuildable local projection.
CREATE INDEX knowledge_semantic_vectors_embedding_hnsw_idx
  ON knowledge_semantic_vectors USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
