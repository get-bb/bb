CREATE TABLE `__new_system_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`claude_code_mock_cli_traffic` integer NOT NULL,
	`popout_chat` integer NOT NULL,
	`popout_chat_hotkey` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_system_experiments`("id", "claude_code_mock_cli_traffic", "popout_chat", "popout_chat_hotkey", "updated_at")
SELECT "id", "claude_code_mock_cli_traffic", false, 'Alt+Space', "updated_at"
FROM `system_experiments`;
--> statement-breakpoint
DROP TABLE `system_experiments`;
--> statement-breakpoint
ALTER TABLE `__new_system_experiments` RENAME TO `system_experiments`;
