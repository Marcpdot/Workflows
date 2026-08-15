-- Durable experiences own raw experienced content. Knowledge keeps source
-- content only as a fallback for events with no durable experience backing.
UPDATE knowledge_events
SET source_content = NULL
WHERE source_content IS NOT NULL
  AND jsonb_typeof(action_metadata -> 'sourceExperienceIds') = 'array'
  AND jsonb_array_length(action_metadata -> 'sourceExperienceIds') > 0;

ALTER TABLE knowledge_events
  ADD CONSTRAINT knowledge_events_source_content_fallback_check
  CHECK (
    source_content IS NULL
    OR CASE
      WHEN jsonb_typeof(action_metadata -> 'sourceExperienceIds') = 'array'
        THEN jsonb_array_length(action_metadata -> 'sourceExperienceIds') = 0
      ELSE true
    END
  );

COMMENT ON COLUMN knowledge_events.source_content IS
  'Fallback source snapshot for events without durable experience IDs; never authoritative over referenced experiences.';
