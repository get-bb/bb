UPDATE hosts
SET machine_provider_id = 'manual', resource = json_object('version', 1, 'hostId', id)
WHERE machine_provider_id IS NULL
  AND id NOT IN (SELECT id FROM temp.bb_migration_local_host);
