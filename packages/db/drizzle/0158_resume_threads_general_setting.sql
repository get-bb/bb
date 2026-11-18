INSERT INTO app_settings_values (key, value, updated_at)
SELECT key, CASE WHEN value = 1 THEN 'true' ELSE 'false' END, updated_at
FROM system_experiments
WHERE key = 'resumeThreadsAfterRestart'
ON CONFLICT (key) DO NOTHING;
