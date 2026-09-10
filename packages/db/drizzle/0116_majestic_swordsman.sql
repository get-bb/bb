ALTER TABLE `threads` RENAME COLUMN "pending_start_context" TO "startup_context";--> statement-breakpoint
ALTER TABLE `environments` ADD `owner_thread_id` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `environments` ADD `status_message` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `pending_log` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `environments` ADD `claim_path` text;--> statement-breakpoint
CREATE UNIQUE INDEX `environments_owner_thread_idx` ON `environments` (`owner_thread_id`);--> statement-breakpoint
CREATE INDEX `environments_claim_idx` ON `environments` (`host_id`,`claim_path`);
--> statement-breakpoint
UPDATE threads SET startup_context = json_set(startup_context, '$.kind', 'pending') WHERE startup_context IS NOT NULL;
--> statement-breakpoint
UPDATE threads SET startup_context = json_object(
  'kind', CASE WHEN (SELECT json_extract(e.data, '$.status') FROM events e WHERE e.thread_id = threads.id AND e.type = 'system/thread-provisioning' ORDER BY e.sequence DESC LIMIT 1) = 'completed' THEN 'dispatched' ELSE 'provisioning' END,
  'request', json(CASE WHEN l.environment_id IS NULL THEN l.request ELSE json_set(l.request, '$.environmentIntent', json_object('type', 'reuse', 'environmentId', l.environment_id)) END),
  'state', json_object('environmentId', NULL, 'provisionEventSequence', NULL,
    'provisioningId', 'provision_migrated_' || threads.id, 'workspaceReadyEventSequence', NULL)
) FROM environment_launches l WHERE l.thread_id = threads.id AND l.request IS NOT NULL AND threads.status != 'pending';
--> statement-breakpoint
CREATE TEMP TABLE environment_provisioning_migration AS
SELECT l.thread_id, COALESCE(l.environment_id,
  (SELECT e.id FROM environments e WHERE e.project_id = t.project_id AND e.host_id = COALESCE(l.host_id, json_extract(l.selection, '$.machine.hostId')) AND e.path = l.path),
  'env_provision_' || l.thread_id) AS environment_id,
  t.project_id, COALESCE(l.host_id, json_extract(l.selection, '$.machine.hostId')) AS host_id
FROM environment_launches l JOIN threads t ON t.id = l.thread_id
WHERE l.attempt > 0;
--> statement-breakpoint
INSERT INTO environments (id, project_id, host_id, path, status, created_at, updated_at)
SELECT m.environment_id, m.project_id, m.host_id, CASE WHEN l.path_rejected THEN NULL ELSE l.path END,
  CASE WHEN l.phase = 'cancelled' AND NOT l.cancel_pending THEN 'destroyed' WHEN l.phase IN ('failed', 'cancelled') THEN 'error' WHEN l.phase = 'creating' THEN 'creating' ELSE 'provisioning' END,
  l.started_at, l.started_at
FROM environment_provisioning_migration m JOIN environment_launches l ON l.thread_id = m.thread_id
WHERE NOT EXISTS (SELECT 1 FROM environments e WHERE e.id = m.environment_id)
GROUP BY m.environment_id;
--> statement-breakpoint
UPDATE environments SET
  owner_thread_id = l.thread_id, attempt = l.attempt,
  status_message = COALESCE(l.message, NULLIF(l.step_text, '')),
  pending_log = l.pending_log,
  claim_path = CASE WHEN l.path_rejected OR l.environment_id IS NOT NULL THEN NULL ELSE l.claim_path END,
  environment_provider_id = l.provider_id, environment_provider_plugin_id = l.provider_plugin_id,
  environment_provider_instance_key = l.path_key, environment_provider_selection = l.selection,
  provider_owns_path = l.owns_path, resource = l.resource, merge_base_branch = l.merge_base_branch,
  teardown_status = CASE WHEN l.path_rejected THEN 'removed' WHEN l.phase = 'cancelled' AND NOT l.cancel_pending AND l.environment_id IS NULL THEN 'removed' WHEN l.phase = 'cancelled' AND l.cancel_pending AND l.environment_id IS NULL THEN 'running' ELSE environments.teardown_status END
FROM environment_launches l JOIN environment_provisioning_migration m ON m.thread_id = l.thread_id
WHERE l.environment_id IS NULL AND environments.id = m.environment_id AND l.thread_id = (
  SELECT candidate.thread_id FROM environment_provisioning_migration candidate
  JOIN environment_launches launch ON launch.thread_id = candidate.thread_id
  WHERE candidate.environment_id = m.environment_id ORDER BY launch.started_at DESC, candidate.thread_id DESC LIMIT 1
);
--> statement-breakpoint
DROP TABLE environment_provisioning_migration;
--> statement-breakpoint
DROP TABLE environment_launches;
