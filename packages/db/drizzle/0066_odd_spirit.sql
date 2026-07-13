CREATE TABLE `marketplaces` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`source_kind` text NOT NULL,
	`location` text NOT NULL,
	`requested_git_ref` text,
	`resolved_git_commit` text,
	`cache_path` text,
	`content_hash` text,
	`catalog_json` text,
	`enabled` integer NOT NULL,
	`trusted` integer NOT NULL,
	`update_policy` text NOT NULL,
	`auto_check` integer DEFAULT false NOT NULL,
	`auto_apply` integer DEFAULT false NOT NULL,
	`last_successful_refresh_at` integer,
	`last_attempted_refresh_at` integer,
	`last_error` text,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `plugin_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`npm_resolved_version` text,
	`git_resolved_commit` text,
	`path` text NOT NULL,
	`integrity` text,
	`content_hash` text,
	`validation_result` text NOT NULL,
	`validation_detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`validated_at` integer
);
--> statement-breakpoint
CREATE INDEX `plugin_artifacts_plugin_idx` ON `plugin_artifacts` (`plugin_id`);--> statement-breakpoint
CREATE TABLE `plugin_state_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`from_artifact_id` text,
	`to_artifact_id` text NOT NULL,
	`snapshot_path` text NOT NULL,
	`database_path` text,
	`state_path` text NOT NULL,
	`secrets_path` text,
	`registration_path` text,
	`status` text NOT NULL,
	`rollback_candidate_version` text,
	`rollback_source_fingerprint` text,
	`rollback_bb_version` text,
	`rollback_sdk_version` text,
	`rollback_detail` text,
	`created_at` integer NOT NULL,
	`retained_until` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plugin_state_snapshots_plugin_idx` ON `plugin_state_snapshots` (`plugin_id`);--> statement-breakpoint
CREATE INDEX `plugin_state_snapshots_retention_idx` ON `plugin_state_snapshots` (`retained_until`);--> statement-breakpoint
CREATE TABLE `plugin_update_events` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`kind` text NOT NULL,
	`from_version` text,
	`to_version` text,
	`outcome` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL,
	`retained_until` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plugin_update_events_plugin_idx` ON `plugin_update_events` (`plugin_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `plugin_update_events_retention_idx` ON `plugin_update_events` (`retained_until`);--> statement-breakpoint
ALTER TABLE `app_settings` ADD `plugin_auto_apply_disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `provenance` text DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `marketplace_id` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `marketplace_entry_id` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_kind` text DEFAULT 'path' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_path` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_builtin_name` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_npm_package` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_npm_registry` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_npm_requested_spec` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_npm_spec_kind` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_git_url` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_git_subdirectory` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_git_requested_ref` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `source_git_ref_kind` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `npm_resolved_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `npm_integrity` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `git_resolved_commit` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `update_policy` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `auto_apply` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plugins` ADD `last_update_check_at` integer;--> statement-breakpoint
ALTER TABLE `plugins` ADD `available_compatible_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `newest_incompatible_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `update_status_detail` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `ignored_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantined_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantine_source_fingerprint` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantine_bb_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantine_sdk_version` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantined_at` integer;--> statement-breakpoint
ALTER TABLE `plugins` ADD `quarantine_detail` text;--> statement-breakpoint
ALTER TABLE `plugins` ADD `active_artifact_id` text REFERENCES plugin_artifacts(id);--> statement-breakpoint
ALTER TABLE `plugins` ADD `normalization_version` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `marketplaces` SET `auto_check` = true WHERE `scope` IN ('builtin', 'managed');
