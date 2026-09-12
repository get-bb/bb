CREATE TABLE `environment_hook_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`host_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text
);
--> statement-breakpoint
ALTER TABLE `hosts` ADD `machine_provider_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `launch_key` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `machine_inputs` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `machine_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `pending_log` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `machine_operation_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `server_access_provider_id` text;--> statement-breakpoint
UPDATE `hosts` SET `server_access_provider_id` = 'connect' WHERE `connect_machine_id` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `server_access_grant_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `resource` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `phase` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `status_message` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `suspend_retry_at` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `remove_retry_at` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `teardown_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `teardown_status` text;--> statement-breakpoint
CREATE UNIQUE INDEX `hosts_live_launch_key_idx` ON `hosts` (`launch_key`) WHERE "hosts"."destroyed_at" is null;--> statement-breakpoint
ALTER TABLE `project_sources` ADD `owns_path` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `host_daemon_sessions` DROP COLUMN `host_type`;
--> statement-breakpoint
UPDATE hosts
SET machine_provider_id = 'manual', resource = json_object('version', 1, 'hostId', id)
WHERE machine_provider_id IS NULL
  AND id NOT IN (SELECT id FROM temp.bb_migration_local_host);
