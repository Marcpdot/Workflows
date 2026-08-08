-- Relation triples are not canonical identities. Separate accepted edges can
-- carry distinct provenance/history even when their endpoints and relation
-- match. Domain operations decide when reuse is appropriate.
DROP INDEX IF EXISTS knowledge_edges_accepted_identity_idx;
