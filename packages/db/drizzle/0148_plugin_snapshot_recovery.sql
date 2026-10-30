ALTER TABLE `plugin_state_snapshots` ADD `operation` text DEFAULT 'update' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugin_state_snapshots` ADD `failure_detail` text;