ALTER TABLE `plugin_state_snapshots` ADD `registration_path` text;--> statement-breakpoint
ALTER TABLE `plugin_state_snapshots` ADD `rollback_candidate_version` text;--> statement-breakpoint
ALTER TABLE `plugin_state_snapshots` ADD `rollback_source_fingerprint` text;--> statement-breakpoint
ALTER TABLE `plugin_state_snapshots` ADD `rollback_bb_version` text;--> statement-breakpoint
ALTER TABLE `plugin_state_snapshots` ADD `rollback_sdk_version` text;--> statement-breakpoint
ALTER TABLE `plugin_state_snapshots` ADD `rollback_detail` text;