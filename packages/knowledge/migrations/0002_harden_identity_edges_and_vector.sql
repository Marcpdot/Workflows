CREATE EXTENSION IF NOT EXISTS vector;

-- Labels are lookup candidates, not canonical identity. Claims, events and
-- sources can legitimately share a normalized label within one workspace;
-- identity resolution and merge decisions remain in the knowledge domain.
DROP INDEX IF EXISTS knowledge_nodes_accepted_identity_idx;

-- Self-relations are meaningful for some domain vocabularies. Do not impose a
-- universal graph invariant unless the domain contract defines one.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'knowledge_edges'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ~ 'from_node_id.*<>.*to_node_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE knowledge_edges DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END
$$;
