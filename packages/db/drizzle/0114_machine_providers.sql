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
	`cleanup_resource_removed` integer DEFAULT false NOT NULL,
	`cancel_pending` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `machine_launches_phase_idx` ON `machine_launches` (`phase`);--> statement-breakpoint
ALTER TABLE `hosts` ADD `machine_provider_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `server_access_provider_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `server_access_grant_id` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `resource` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `machine_provider_selection` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `phase` text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `suspended_at` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `retire_at` integer;--> statement-breakpoint
ALTER TABLE `hosts` ADD `teardown_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `teardown_status` text;--> statement-breakpoint
ALTER TABLE `hosts` ADD `teardown_message` text;--> statement-breakpoint
ALTER TABLE `hosts` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `host_daemon_sessions` DROP COLUMN `host_type`;