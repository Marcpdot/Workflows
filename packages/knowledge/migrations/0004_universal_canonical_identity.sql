-- Canonical identity is universal and must not be limited to today's initial
-- ontology. Domain contracts still provide known node types, while PostgreSQL
-- accepts future independently referable kinds without a schema rewrite.
DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'knowledge_nodes'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%type%concept%claim%'
  LOOP
    EXECUTE format(
      'ALTER TABLE knowledge_nodes DROP CONSTRAINT %I',
      constraint_name
    );
  END LOOP;
END
$$;
