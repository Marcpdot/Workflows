-- Transform jobs are the operator gate for ingested material. As-is bytes/text
-- and stable chunks are preserved as-is; they do not rewrite meaning. Canonical
-- retrieve reads only accepted jobs.

CREATE TABLE knowledge_transform_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('awaiting_accept', 'accepted', 'rejected', 'failed')),
  source_kind text NOT NULL,
  source_path text,
  source_ref text NOT NULL,
  workspace_id text,
  error text,
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CHECK (
    (status = 'awaiting_accept' AND resolved_at IS NULL)
    OR (status IN ('accepted', 'rejected', 'failed') AND resolved_at IS NOT NULL)
  ),
  CHECK (status <> 'failed' OR error IS NOT NULL)
);
CREATE INDEX knowledge_transform_jobs_status_created_idx
  ON knowledge_transform_jobs (status, created_at DESC, id DESC);
CREATE INDEX knowledge_transform_jobs_workspace_status_idx
  ON knowledge_transform_jobs (workspace_id, status);

CREATE TABLE knowledge_as_is (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES knowledge_transform_jobs(id),
  path text NOT NULL,
  content_hash text NOT NULL,
  media_type text NOT NULL,
  text text,
  bytes bytea,
  byte_length integer NOT NULL CHECK (byte_length >= 0),
  workspace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id)
);
CREATE INDEX knowledge_as_is_path_idx ON knowledge_as_is (path);
CREATE INDEX knowledge_as_is_content_hash_idx ON knowledge_as_is (content_hash);

CREATE TABLE knowledge_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES knowledge_transform_jobs(id),
  as_is_id uuid NOT NULL REFERENCES knowledge_as_is(id),
  path text NOT NULL,
  content_hash text NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  char_start integer NOT NULL CHECK (char_start >= 0),
  char_end integer NOT NULL CHECK (char_end >= char_start),
  byte_start integer CHECK (byte_start IS NULL OR byte_start >= 0),
  byte_end integer CHECK (
    byte_end IS NULL
    OR (byte_start IS NOT NULL AND byte_end >= byte_start)
  ),
  text text NOT NULL,
  workspace_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, ordinal)
);
CREATE INDEX knowledge_chunks_job_ordinal_idx ON knowledge_chunks (job_id, ordinal);
CREATE INDEX knowledge_chunks_as_is_idx ON knowledge_chunks (as_is_id);
CREATE INDEX knowledge_chunks_path_idx ON knowledge_chunks (path);
CREATE INDEX knowledge_chunks_content_hash_idx ON knowledge_chunks (content_hash);
