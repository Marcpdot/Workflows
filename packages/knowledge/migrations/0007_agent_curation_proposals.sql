ALTER TABLE knowledge_proposals DROP CONSTRAINT knowledge_proposals_kind_check;
ALTER TABLE knowledge_proposals ADD CONSTRAINT knowledge_proposals_kind_check
  CHECK (kind IN ('node', 'edge', 'evidence', 'observation', 'merge', 'supersede'));
