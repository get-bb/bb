DROP INDEX IF EXISTS `thread_search_segments_thread_idx`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_search_segments_thread_source_seq_idx` ON `thread_search_segments` (`thread_id`,`source_seq`);--> statement-breakpoint
ALTER TABLE `environments` ADD `retire_requested_at` integer;--> statement-breakpoint
UPDATE `environments`
SET `retire_requested_at` = `updated_at`
WHERE `status` = 'retiring';--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_system_experiments` (
	`key` text PRIMARY KEY NOT NULL,
	`value` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_system_experiments`("key", "value", "updated_at")
SELECT 'claudeCodeMockCliTraffic', "claude_code_mock_cli_traffic", "updated_at"
FROM `system_experiments`
WHERE "id" = 'current'
UNION ALL
SELECT 'newOnboarding', false, "updated_at"
FROM `system_experiments`
WHERE "id" = 'current'
UNION ALL
SELECT 'toolsHub', "tools_hub", "updated_at"
FROM `system_experiments`
WHERE "id" = 'current';--> statement-breakpoint
DROP TABLE `system_experiments`;--> statement-breakpoint
ALTER TABLE `__new_system_experiments` RENAME TO `system_experiments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_background_task_thread_type_item_sequence_idx` ON `events` (`thread_id`,`type`,`item_id`,`sequence`) WHERE "events"."item_kind" = 'backgroundTask';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_goal_thread_sequence_idx` ON `events` (`thread_id`,`sequence`) WHERE "events"."type" IN ('thread/goal/updated', 'thread/goal/cleared');
