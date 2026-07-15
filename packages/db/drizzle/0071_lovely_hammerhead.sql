CREATE TABLE `__new_system_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`claude_code_mock_cli_traffic` integer NOT NULL,
	`thread_splits` integer DEFAULT false NOT NULL,
	`plugins` integer DEFAULT false NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_system_experiments`("id", "claude_code_mock_cli_traffic", "thread_splits", "plugins", "updated_at")
SELECT "id", "claude_code_mock_cli_traffic", "thread_splits", "plugins", "updated_at"
FROM `system_experiments`;
--> statement-breakpoint
DROP TABLE `system_experiments`;
--> statement-breakpoint
ALTER TABLE `__new_system_experiments` RENAME TO `system_experiments`;
