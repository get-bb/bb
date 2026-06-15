UPDATE events
SET data = json_remove(
  json_set(
    data,
    '$.item.aggregatedOutput',
    (
      SELECT event_large_values.value
      FROM event_large_values
      WHERE event_large_values.event_id = events.id
        AND event_large_values.json_path = '$.item.aggregatedOutput'
    )
  ),
  '$.item.truncation'
)
WHERE id IN (
  SELECT event_id
  FROM event_large_values
  WHERE event_large_values.json_path = '$.item.aggregatedOutput'
);--> statement-breakpoint
UPDATE events
SET data = json_remove(
  json_set(
    data,
    '$.item.resultText',
    (
      SELECT event_large_values.value
      FROM event_large_values
      WHERE event_large_values.event_id = events.id
        AND event_large_values.json_path = '$.item.resultText'
    )
  ),
  '$.item.truncation'
)
WHERE id IN (
  SELECT event_id
  FROM event_large_values
  WHERE event_large_values.json_path = '$.item.resultText'
);--> statement-breakpoint
UPDATE events
SET data = json_remove(
  json_set(
    data,
    '$.item.result',
    (
      SELECT event_large_values.value
      FROM event_large_values
      WHERE event_large_values.event_id = events.id
        AND event_large_values.json_path = '$.item.result'
        AND event_large_values.storage_kind = 'text'
    )
  ),
  '$.item.truncation'
)
WHERE id IN (
  SELECT event_id
  FROM event_large_values
  WHERE event_large_values.json_path = '$.item.result'
    AND event_large_values.storage_kind = 'text'
);--> statement-breakpoint
UPDATE events
SET data = json_remove(
  json_set(
    data,
    '$.item.result',
    json((
      SELECT event_large_values.value
      FROM event_large_values
      WHERE event_large_values.event_id = events.id
        AND event_large_values.json_path = '$.item.result'
        AND event_large_values.storage_kind = 'json'
    ))
  ),
  '$.item.truncation'
)
WHERE id IN (
  SELECT event_id
  FROM event_large_values
  WHERE event_large_values.json_path = '$.item.result'
    AND event_large_values.storage_kind = 'json'
);--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS event_large_value_restore_file_diff_targets (
  event_id text NOT NULL,
  patch_index integer NOT NULL,
  json_path text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (event_id, patch_index)
) WITHOUT ROWID;--> statement-breakpoint
DELETE FROM event_large_value_restore_file_diff_targets;--> statement-breakpoint
INSERT INTO event_large_value_restore_file_diff_targets (
  event_id,
  patch_index,
  json_path,
  value
)
SELECT
  event_id,
  row_number() OVER (
    PARTITION BY event_id
    ORDER BY json_path
  ) AS patch_index,
  json_path,
  value
FROM event_large_values
WHERE value_kind = 'file_change_diff';--> statement-breakpoint
WITH RECURSIVE
  patched_events(event_id, patch_index, data) AS (
    SELECT
      events.id,
      0,
      events.data
    FROM events
    WHERE events.id IN (
      SELECT event_id
      FROM event_large_value_restore_file_diff_targets AS targets
      WHERE targets.patch_index = 1
    )
    UNION ALL
    SELECT
      patched_events.event_id,
      targets.patch_index,
      json_set(patched_events.data, targets.json_path, targets.value)
    FROM patched_events
    JOIN event_large_value_restore_file_diff_targets AS targets
      ON targets.event_id = patched_events.event_id
     AND targets.patch_index = patched_events.patch_index + 1
  ),
  final_patched_events AS (
    SELECT
      patched_events.event_id,
      patched_events.data
    FROM patched_events
    LEFT JOIN event_large_value_restore_file_diff_targets AS next_targets
      ON next_targets.event_id = patched_events.event_id
     AND next_targets.patch_index = patched_events.patch_index + 1
    WHERE patched_events.patch_index > 0
      AND next_targets.event_id IS NULL
  )
UPDATE events
SET data = (
  SELECT final_patched_events.data
  FROM final_patched_events
  WHERE final_patched_events.event_id = events.id
)
WHERE events.id IN (
  SELECT event_id
  FROM final_patched_events
);--> statement-breakpoint
DROP TABLE event_large_value_restore_file_diff_targets;--> statement-breakpoint
DROP TABLE event_large_values;
