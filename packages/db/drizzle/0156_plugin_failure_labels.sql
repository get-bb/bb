ALTER TABLE `plugins` ADD `last_failure_label` text;--> statement-breakpoint
ALTER TABLE `plugin_state_snapshots` ADD `rollback_candidate_label` text;