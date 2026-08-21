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
SELECT 'newOnboarding', "new_onboarding", "updated_at"
FROM `system_experiments`
WHERE "id" = 'current'
UNION ALL
SELECT 'toolsHub', "tools_hub", "updated_at"
FROM `system_experiments`
WHERE "id" = 'current';--> statement-breakpoint
DROP TABLE `system_experiments`;--> statement-breakpoint
ALTER TABLE `__new_system_experiments` RENAME TO `system_experiments`;--> statement-breakpoint
PRAGMA foreign_keys=ON;
