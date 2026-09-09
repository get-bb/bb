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
CREATE TABLE `environment_setup_outcomes` (
	`host_id` text NOT NULL,
	`path` text NOT NULL,
	`operation_id` text NOT NULL,
	`state` text NOT NULL,
	`input_hash` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`host_id`, `path`),
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `machine_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`key` text NOT NULL,
	`host_id` text NOT NULL,
	`state` text NOT NULL,
	`encrypted_bootstrap` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `machine_enrollments_owner_key_idx` ON `machine_enrollments` (`owner`,`key`);--> statement-breakpoint
CREATE UNIQUE INDEX `machine_enrollments_host_id_idx` ON `machine_enrollments` (`host_id`);--> statement-breakpoint
CREATE TABLE `machine_launches` (
	`key` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`project_id` text,
	`inputs` text,
	`attempt` integer NOT NULL,
	`phase` text NOT NULL,
	`started_at` integer NOT NULL,
	`failed_at` integer,
	`failure` text,
	`message` text,
	`transient_failures` integer NOT NULL,
	`host_id` text,
	`resource` text,
	`step_text` text NOT NULL,
	`pending_log` text NOT NULL,
	`cleanup_retry_at` integer,
	`cleanup_resource_removed` integer DEFAULT false NOT NULL,
	`cancel_pending` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `machine_launches_phase_idx` ON `machine_launches` (`phase`);--> statement-breakpoint
CREATE INDEX `machine_launches_host_id_idx` ON `machine_launches` (`host_id`);--> statement-breakpoint
CREATE TABLE `machine_lifecycles` (
	`host_id` text PRIMARY KEY NOT NULL,
	`restore_operation_id` text,
	`restore_checkouts` text,
	`recovery_state` text NOT NULL,
	`message` text,
	`lease_id` text,
	`lease_until` integer,
	`retry_at` integer,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `hosts` ADD `machine_provider_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `machine_operation_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `server_access_provider_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `server_access_grant_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `resource` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `machine_provider_selection` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `phase` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `idle_since` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `removal_started_at` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `retire_at` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `teardown_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `teardown_status` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `teardown_message` text;--> statement-breakpoint
ALTER TABLE `hosts` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `project_sources` ADD `owns_path` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `host_daemon_sessions` DROP COLUMN `host_type`;
--> statement-breakpoint
UPDATE hosts
SET machine_provider_id = 'manual', resource = json_object('version', 1, 'hostId', id)
WHERE machine_provider_id IS NULL
  AND id NOT IN (SELECT id FROM temp.bb_migration_local_host);
