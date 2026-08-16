-- Representation gaps reuse proposal/event lifecycle rather than creating a
-- second ontology or source store. Resolution remains contextual and auditable.
ALTER TABLE knowledge_proposals DROP CONSTRAINT knowledge_proposals_kind_check;
ALTER TABLE knowledge_proposals ADD CONSTRAINT knowledge_proposals_kind_check
  CHECK (kind IN (
    'node', 'edge', 'evidence', 'observation', 'merge', 'supersede',
    'representation_gap'
  ));

CREATE INDEX knowledge_proposals_kind_status_created_idx
  ON knowledge_proposals (kind, status, created_at DESC);
