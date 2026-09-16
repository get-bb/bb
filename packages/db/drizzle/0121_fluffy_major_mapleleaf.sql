ALTER TABLE `threads` ADD `lifecycle_owner_thread_id` text REFERENCES threads(id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX `threads_lifecycle_owner_idx` ON `threads` (`lifecycle_owner_thread_id`);
--> statement-breakpoint
UPDATE threads AS dependent SET lifecycle_owner_thread_id = source_thread_id
WHERE origin_plugin_id = 'side-chat' AND origin_kind = 'fork' AND visibility = 'hidden'
AND EXISTS (SELECT 1 FROM threads owner WHERE owner.id = dependent.source_thread_id
  AND owner.project_id = dependent.project_id AND owner.created_at < dependent.created_at);
--> statement-breakpoint
UPDATE threads AS dependent SET lifecycle_owner_thread_id = (
  SELECT json_extract(metadata_json, '$.originThreadId') FROM thread_plugin_metadata
  WHERE thread_id = dependent.id AND plugin_id = 'workflows'
)
WHERE dependent.origin_plugin_id = 'workflows' AND dependent.lifecycle_owner_thread_id IS NULL
AND EXISTS (SELECT 1 FROM thread_plugin_metadata metadata JOIN threads owner
  ON owner.id = json_extract(metadata.metadata_json, '$.originThreadId')
  WHERE metadata.thread_id = dependent.id AND metadata.plugin_id = 'workflows'
  AND json_extract(metadata.metadata_json, '$.workflowWorker') = 1
  AND json_type(metadata.metadata_json, '$.runId') = 'text'
  AND json_type(metadata.metadata_json, '$.callId') = 'text'
  AND owner.project_id = dependent.project_id AND owner.created_at < dependent.created_at);
--> statement-breakpoint
WITH RECURSIVE owned(id) AS (
  SELECT id FROM threads WHERE archived_at IS NOT NULL
  UNION SELECT t.id FROM threads t JOIN owned ON t.lifecycle_owner_thread_id = owned.id
) UPDATE threads SET archived_at = coalesce(archived_at, unixepoch() * 1000) WHERE id IN (SELECT id FROM owned);
--> statement-breakpoint
WITH RECURSIVE owned(id) AS (
  SELECT id FROM threads WHERE deleted_at IS NOT NULL
  UNION SELECT t.id FROM threads t JOIN owned ON t.lifecycle_owner_thread_id = owned.id
) UPDATE threads SET deleted_at = coalesce(deleted_at, unixepoch() * 1000) WHERE id IN (SELECT id FROM owned);
--> statement-breakpoint
CREATE TRIGGER threads_lifecycle_owner_insert BEFORE INSERT ON threads
WHEN NEW.lifecycle_owner_thread_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid lifecycle owner') WHERE NEW.id = NEW.lifecycle_owner_thread_id
    OR NOT EXISTS (SELECT 1 FROM threads owner WHERE owner.id = NEW.lifecycle_owner_thread_id
      AND owner.archived_at IS NULL AND owner.deleted_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER threads_lifecycle_owner_immutable BEFORE UPDATE OF lifecycle_owner_thread_id ON threads
WHEN NEW.lifecycle_owner_thread_id IS NOT OLD.lifecycle_owner_thread_id
BEGIN
  SELECT RAISE(ABORT, 'lifecycle ownership is immutable');
END;
