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
ALTER TABLE `plugins` ADD `auto_apply` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `marketplaces` ADD `auto_check` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `marketplaces` ADD `auto_apply` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `marketplaces` SET `auto_check` = true WHERE `scope` IN ('builtin', 'managed');
