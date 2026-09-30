WITH directions(command, key) AS (
  VALUES ('pane.focus.left', 'ArrowLeft'),
         ('pane.focus.right', 'ArrowRight'),
         ('pane.focus.up', 'ArrowUp'),
         ('pane.focus.down', 'ArrowDown')
), existing AS (
  SELECT value FROM json_each(COALESCE(
    (SELECT value FROM app_settings_values WHERE key = 'keybindingOverrides'),
    '[]'
  ))
), missing AS (
  SELECT json_object(
    'command', directions.command,
    'platform', 'mac',
    'shortcut', json_object(
      'key', directions.key,
      'mod', json('true'),
      'meta', json('false'),
      'control', json('false'),
      'alt', json('false'),
      'shift', json('true')
    )
  ) AS value
  FROM directions
  WHERE NOT EXISTS (
    SELECT 1 FROM existing WHERE json_extract(existing.value, '$.command') = directions.command
  )
)
INSERT INTO app_settings_values (key, value, updated_at)
SELECT 'keybindingOverrides', (
  SELECT json_group_array(json(value)) FROM (
    SELECT value FROM existing
    UNION ALL
    SELECT value FROM missing
  )
), CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE EXISTS (SELECT 1 FROM bb_migration_existing_installation WHERE existing = 1)
  AND EXISTS (SELECT 1 FROM missing)
ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at;
