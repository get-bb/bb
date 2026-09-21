INSERT INTO thread_search_segments (`id`, `thread_id`, `source_kind`, `source_key`, `source_seq`, `text`, `created_at`, `updated_at`)
SELECT
  q.thread_id || ':user_message:queued:' || q.id,
  q.thread_id,
  'user_message',
  'queued:' || q.id,
  NULL,
  trim(COALESCE((
    SELECT group_concat(json_extract(part.value, '$.text'), char(10))
    FROM json_each(q.content) AS part
    WHERE json_extract(part.value, '$.type') = 'text'
      AND COALESCE(json_extract(part.value, '$.visibility'), '') <> 'agent-only'
  ), '')),
  q.created_at,
  q.updated_at
FROM queued_thread_messages AS q
WHERE q.system_notice IS NULL
  AND EXISTS (
    SELECT 1 FROM json_each(q.content) AS part
    WHERE json_extract(part.value, '$.type') = 'text'
      AND COALESCE(json_extract(part.value, '$.visibility'), '') <> 'agent-only'
      AND trim(json_extract(part.value, '$.text')) <> ''
  );
--> statement-breakpoint
CREATE TRIGGER queued_thread_messages_search_insert
AFTER INSERT ON queued_thread_messages
WHEN NEW.system_notice IS NULL
BEGIN
  INSERT INTO thread_search_segments (`id`, `thread_id`, `source_kind`, `source_key`, `source_seq`, `text`, `created_at`, `updated_at`)
  SELECT
  NEW.thread_id || ':user_message:queued:' || NEW.id,
  NEW.thread_id,
  'user_message',
  'queued:' || NEW.id,
  NULL,
  trim(COALESCE((
    SELECT group_concat(json_extract(part.value, '$.text'), char(10))
    FROM json_each(NEW.content) AS part
    WHERE json_extract(part.value, '$.type') = 'text'
      AND COALESCE(json_extract(part.value, '$.visibility'), '') <> 'agent-only'
  ), '')),
  NEW.created_at,
  NEW.updated_at
  WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.content) AS part
    WHERE json_extract(part.value, '$.type') = 'text'
      AND COALESCE(json_extract(part.value, '$.visibility'), '') <> 'agent-only'
      AND trim(json_extract(part.value, '$.text')) <> ''
  );
END;
--> statement-breakpoint
CREATE TRIGGER queued_thread_messages_search_update
AFTER UPDATE OF content, system_notice ON queued_thread_messages
BEGIN
  DELETE FROM thread_search_segments
  WHERE id = OLD.thread_id || ':user_message:queued:' || OLD.id;
  INSERT INTO thread_search_segments (`id`, `thread_id`, `source_kind`, `source_key`, `source_seq`, `text`, `created_at`, `updated_at`)
  SELECT
  NEW.thread_id || ':user_message:queued:' || NEW.id,
  NEW.thread_id,
  'user_message',
  'queued:' || NEW.id,
  NULL,
  trim(COALESCE((
    SELECT group_concat(json_extract(part.value, '$.text'), char(10))
    FROM json_each(NEW.content) AS part
    WHERE json_extract(part.value, '$.type') = 'text'
      AND COALESCE(json_extract(part.value, '$.visibility'), '') <> 'agent-only'
  ), '')),
  NEW.created_at,
  NEW.updated_at
  WHERE NEW.system_notice IS NULL
    AND EXISTS (
      SELECT 1 FROM json_each(NEW.content) AS part
      WHERE json_extract(part.value, '$.type') = 'text'
        AND COALESCE(json_extract(part.value, '$.visibility'), '') <> 'agent-only'
        AND trim(json_extract(part.value, '$.text')) <> ''
    );
END;
--> statement-breakpoint
CREATE TRIGGER queued_thread_messages_search_delete
AFTER DELETE ON queued_thread_messages
BEGIN
  DELETE FROM thread_search_segments
  WHERE id = OLD.thread_id || ':user_message:queued:' || OLD.id;
END;
