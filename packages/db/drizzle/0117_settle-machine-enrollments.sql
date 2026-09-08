UPDATE machine_enrollments
SET state = 'cancelled', encrypted_bootstrap = NULL, expires_at = NULL
WHERE host_id IN (SELECT id FROM hosts WHERE destroyed_at IS NOT NULL)
   OR host_id IN (SELECT host_id FROM machine_launches WHERE phase = 'cancelled' OR (phase = 'failed' AND failure = 'terminal'));
