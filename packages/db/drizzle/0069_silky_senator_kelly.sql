CREATE TABLE `plugin_state_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`from_artifact_id` text,
	`to_artifact_id` text NOT NULL,
	`snapshot_path` text NOT NULL,
	`database_path` text,
	`state_path` text NOT NULL,
	`secrets_path` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`retained_until` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plugin_state_snapshots_plugin_idx` ON `plugin_state_snapshots` (`plugin_id`);--> statement-breakpoint
CREATE INDEX `plugin_state_snapshots_retention_idx` ON `plugin_state_snapshots` (`retained_until`);--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantined_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantine_source_fingerprint` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantine_bb_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantine_sdk_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantined_at` integer;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantine_detail` text;