CREATE TEMP TABLE IF NOT EXISTS event_large_value_restore_text_targets (
  event_id text NOT NULL,
  patch_index integer NOT NULL,
  json_path text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (event_id, patch_index)
) WITHOUT ROWID;--> statement-breakpoint
DELETE FROM event_large_value_restore_text_targets;--> statement-breakpoint
INSERT INTO event_large_value_restore_text_targets (
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
WHERE storage_kind = 'text';--> statement-breakpoint
WITH RECURSIVE
  patched_events(event_id, patch_index, data) AS (
    SELECT
      events.id,
      0,
      events.data
    FROM events
    WHERE EXISTS (
      SELECT 1
      FROM event_large_value_restore_text_targets AS targets
      WHERE targets.event_id = events.id
        AND targets.patch_index = 1
    )
    UNION ALL
    SELECT
      patched_events.event_id,
      targets.patch_index,
      json_set(patched_events.data, targets.json_path, targets.value)
    FROM patched_events
    JOIN event_large_value_restore_text_targets AS targets
      ON targets.event_id = patched_events.event_id
     AND targets.patch_index = patched_events.patch_index + 1
  ),
  final_patched_events AS (
    SELECT
      patched_events.event_id,
      json_remove(patched_events.data, '$.item.truncation') AS data
    FROM patched_events
    LEFT JOIN event_large_value_restore_text_targets AS next_targets
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
DROP TABLE event_large_value_restore_text_targets;--> statement-breakpoint
CREATE TEMP TABLE IF NOT EXISTS event_large_value_restore_json_targets (
  event_id text NOT NULL,
  patch_index integer NOT NULL,
  json_path text NOT NULL,
  value text NOT NULL,
  PRIMARY KEY (event_id, patch_index)
) WITHOUT ROWID;--> statement-breakpoint
DELETE FROM event_large_value_restore_json_targets;--> statement-breakpoint
INSERT INTO event_large_value_restore_json_targets (
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
WHERE storage_kind = 'json';--> statement-breakpoint
WITH RECURSIVE
  patched_events(event_id, patch_index, data) AS (
    SELECT
      events.id,
      0,
      events.data
    FROM events
    WHERE EXISTS (
      SELECT 1
      FROM event_large_value_restore_json_targets AS targets
      WHERE targets.event_id = events.id
        AND targets.patch_index = 1
    )
    UNION ALL
    SELECT
      patched_events.event_id,
      targets.patch_index,
      json_set(patched_events.data, targets.json_path, json(targets.value))
    FROM patched_events
    JOIN event_large_value_restore_json_targets AS targets
      ON targets.event_id = patched_events.event_id
     AND targets.patch_index = patched_events.patch_index + 1
  ),
  final_patched_events AS (
    SELECT
      patched_events.event_id,
      json_remove(patched_events.data, '$.item.truncation') AS data
    FROM patched_events
    LEFT JOIN event_large_value_restore_json_targets AS next_targets
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
DROP TABLE event_large_value_restore_json_targets;--> statement-breakpoint
DROP TABLE event_large_values;
