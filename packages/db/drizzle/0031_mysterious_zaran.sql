CREATE TABLE `event_large_values` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`item_id` text,
	`item_kind` text NOT NULL,
	`value_kind` text NOT NULL,
	`json_path` text NOT NULL,
	`storage_kind` text NOT NULL,
	`value` text NOT NULL,
	`original_length` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `event_large_values_event_path_idx` ON `event_large_values` (`event_id`,`json_path`);--> statement-breakpoint
CREATE INDEX `event_large_values_thread_sequence_idx` ON `event_large_values` (`thread_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `event_large_values_thread_item_idx` ON `event_large_values` (`thread_id`,`item_id`,`item_kind`,`value_kind`,`sequence`);--> statement-breakpoint
INSERT OR IGNORE INTO event_large_values (
  id,
  event_id,
  thread_id,
  sequence,
  item_id,
  item_kind,
  value_kind,
  json_path,
  storage_kind,
  value,
  original_length,
  created_at
)
SELECT
  'elv:' || id || ':aggregatedOutput',
  id,
  thread_id,
  sequence,
  item_id,
  item_kind,
  'command_aggregated_output',
  '$.item.aggregatedOutput',
  'text',
  json_extract(data, '$.item.aggregatedOutput'),
  length(json_extract(data, '$.item.aggregatedOutput')),
  created_at
FROM events
WHERE type = 'item/completed'
  AND item_kind = 'commandExecution'
  AND json_type(data, '$.item.aggregatedOutput') = 'text'
  AND json_type(data, '$.item.truncation.aggregatedOutput') IS NULL
  AND length(json_extract(data, '$.item.aggregatedOutput')) > 512;--> statement-breakpoint
UPDATE events
SET data = json_set(
  data,
  '$.item.aggregatedOutput',
  '',
  '$.item.truncation.aggregatedOutput.originalLength',
  length(json_extract(data, '$.item.aggregatedOutput')),
  '$.item.truncation.aggregatedOutput.retainedHeadLength',
  0,
  '$.item.truncation.aggregatedOutput.retainedTailLength',
  0,
  '$.item.truncation.aggregatedOutput.truncatedAt',
  created_at
)
WHERE type = 'item/completed'
  AND item_kind = 'commandExecution'
  AND json_type(data, '$.item.aggregatedOutput') = 'text'
  AND json_type(data, '$.item.truncation.aggregatedOutput') IS NULL
  AND length(json_extract(data, '$.item.aggregatedOutput')) > 512
  AND EXISTS (
    SELECT 1
    FROM event_large_values
    WHERE event_large_values.event_id = events.id
      AND event_large_values.json_path = '$.item.aggregatedOutput'
  );--> statement-breakpoint
INSERT OR IGNORE INTO event_large_values (
  id,
  event_id,
  thread_id,
  sequence,
  item_id,
  item_kind,
  value_kind,
  json_path,
  storage_kind,
  value,
  original_length,
  created_at
)
SELECT
  'elv:' || id || ':result',
  id,
  thread_id,
  sequence,
  item_id,
  item_kind,
  'tool_result',
  '$.item.result',
  CASE json_type(data, '$.item.result')
    WHEN 'text' THEN 'text'
    ELSE 'json'
  END,
  json_extract(data, '$.item.result'),
  length(json_extract(data, '$.item.result')),
  created_at
FROM events
WHERE type = 'item/completed'
  AND item_kind = 'toolCall'
  AND json_type(data, '$.item.result') IS NOT NULL
  AND json_type(data, '$.item.result') <> 'null'
  AND json_type(data, '$.item.truncation.result') IS NULL
  AND length(COALESCE(json_extract(data, '$.item.result'), '')) > 512;--> statement-breakpoint
UPDATE events
SET data = json_set(
  data,
  '$.item.result',
  '',
  '$.item.truncation.result.originalLength',
  length(json_extract(data, '$.item.result')),
  '$.item.truncation.result.retainedHeadLength',
  0,
  '$.item.truncation.result.retainedTailLength',
  0,
  '$.item.truncation.result.truncatedAt',
  created_at
)
WHERE type = 'item/completed'
  AND item_kind = 'toolCall'
  AND json_type(data, '$.item.result') IS NOT NULL
  AND json_type(data, '$.item.result') <> 'null'
  AND json_type(data, '$.item.truncation.result') IS NULL
  AND length(COALESCE(json_extract(data, '$.item.result'), '')) > 512
  AND EXISTS (
    SELECT 1
    FROM event_large_values
    WHERE event_large_values.event_id = events.id
      AND event_large_values.json_path = '$.item.result'
  );--> statement-breakpoint
INSERT OR IGNORE INTO event_large_values (
  id,
  event_id,
  thread_id,
  sequence,
  item_id,
  item_kind,
  value_kind,
  json_path,
  storage_kind,
  value,
  original_length,
  created_at
)
SELECT
  'elv:' || id || ':resultText',
  id,
  thread_id,
  sequence,
  item_id,
  item_kind,
  CASE item_kind
    WHEN 'webFetch' THEN 'web_fetch_result_text'
    ELSE 'web_search_result_text'
  END,
  '$.item.resultText',
  'text',
  json_extract(data, '$.item.resultText'),
  length(json_extract(data, '$.item.resultText')),
  created_at
FROM events
WHERE type = 'item/completed'
  AND item_kind IN ('webFetch', 'webSearch')
  AND json_type(data, '$.item.resultText') = 'text'
  AND json_type(data, '$.item.truncation.resultText') IS NULL
  AND length(json_extract(data, '$.item.resultText')) > 512;--> statement-breakpoint
UPDATE events
SET data = json_set(
  data,
  '$.item.resultText',
  '',
  '$.item.truncation.resultText.originalLength',
  length(json_extract(data, '$.item.resultText')),
  '$.item.truncation.resultText.retainedHeadLength',
  0,
  '$.item.truncation.resultText.retainedTailLength',
  0,
  '$.item.truncation.resultText.truncatedAt',
  created_at
)
WHERE type = 'item/completed'
  AND item_kind IN ('webFetch', 'webSearch')
  AND json_type(data, '$.item.resultText') = 'text'
  AND json_type(data, '$.item.truncation.resultText') IS NULL
  AND length(json_extract(data, '$.item.resultText')) > 512
  AND EXISTS (
    SELECT 1
    FROM event_large_values
    WHERE event_large_values.event_id = events.id
      AND event_large_values.json_path = '$.item.resultText'
  );
--> statement-breakpoint
INSERT OR IGNORE INTO event_large_values (
  id,
  event_id,
  thread_id,
  sequence,
  item_id,
  item_kind,
  value_kind,
  json_path,
  storage_kind,
  value,
  original_length,
  created_at
)
SELECT
  'elv:' || events.id || ':changes:' || changes.key || ':diff',
  events.id,
  events.thread_id,
  events.sequence,
  events.item_id,
  events.item_kind,
  'file_change_diff',
  '$.item.changes[' || changes.key || '].diff',
  'text',
  json_extract(changes.value, '$.diff'),
  length(json_extract(changes.value, '$.diff')),
  events.created_at
FROM events, json_each(events.data, '$.item.changes') AS changes
WHERE events.type IN ('item/started', 'item/completed')
  AND events.item_kind = 'fileChange'
  AND json_type(changes.value, '$.diff') = 'text'
  AND length(json_extract(changes.value, '$.diff')) > 512;--> statement-breakpoint
WITH RECURSIVE
  target_file_diffs AS (
    SELECT
      events.id AS event_id,
      '$.item.changes[' || changes.key || '].diff' AS json_path
    FROM events, json_each(events.data, '$.item.changes') AS changes
    WHERE events.type IN ('item/started', 'item/completed')
      AND events.item_kind = 'fileChange'
      AND json_type(changes.value, '$.diff') = 'text'
      AND length(json_extract(changes.value, '$.diff')) > 512
      AND EXISTS (
        SELECT 1
        FROM event_large_values
        WHERE event_large_values.event_id = events.id
          AND event_large_values.json_path = '$.item.changes[' || changes.key || '].diff'
      )
  ),
  ranked_file_diffs AS (
    SELECT
      event_id,
      json_path,
      row_number() OVER (
        PARTITION BY event_id
        ORDER BY json_path
      ) AS patch_index
    FROM target_file_diffs
  ),
  patched_events(event_id, patch_index, data) AS (
    SELECT
      events.id,
      0,
      events.data
    FROM events
    WHERE events.id IN (
      SELECT event_id
      FROM target_file_diffs
    )
    UNION ALL
    SELECT
      patched_events.event_id,
      ranked_file_diffs.patch_index,
      json_set(patched_events.data, ranked_file_diffs.json_path, '')
    FROM patched_events
    JOIN ranked_file_diffs
      ON ranked_file_diffs.event_id = patched_events.event_id
     AND ranked_file_diffs.patch_index = patched_events.patch_index + 1
  )
UPDATE events
SET data = (
  SELECT patched_events.data
  FROM patched_events
  WHERE patched_events.event_id = events.id
  ORDER BY patched_events.patch_index DESC
  LIMIT 1
)
WHERE events.id IN (
  SELECT event_id
  FROM target_file_diffs
);
