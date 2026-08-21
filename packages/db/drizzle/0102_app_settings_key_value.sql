CREATE TABLE `app_settings_values` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `app_settings_values` (`key`, `value`, `updated_at`)
SELECT 'showKeyboardHints', CASE WHEN `show_keyboard_hints` THEN 'true' ELSE 'false' END, `updated_at` FROM `app_settings` WHERE `id` = 'current'
UNION ALL
SELECT 'steerActiveThreadOnEnter', CASE WHEN `steer_active_thread_on_enter` THEN 'true' ELSE 'false' END, `updated_at` FROM `app_settings` WHERE `id` = 'current'
UNION ALL
SELECT 'showUnhandledProviderEvents', CASE WHEN `show_unhandled_provider_events` THEN 'true' ELSE 'false' END, `updated_at` FROM `app_settings` WHERE `id` = 'current'
UNION ALL
SELECT 'codexMemoryEnabled', CASE WHEN `codex_memory_enabled` THEN 'true' ELSE 'false' END, `updated_at` FROM `app_settings` WHERE `id` = 'current'
UNION ALL
SELECT 'claudeCodeMemoryEnabled', CASE WHEN `claude_code_memory_enabled` THEN 'true' ELSE 'false' END, `updated_at` FROM `app_settings` WHERE `id` = 'current'
UNION ALL
SELECT 'codexSubagentsDisabled', CASE WHEN `codex_subagents_disabled` THEN 'true' ELSE 'false' END, `updated_at` FROM `app_settings` WHERE `id` = 'current'
UNION ALL
SELECT 'claudeCodeSubagentsDisabled', CASE WHEN `claude_code_subagents_disabled` THEN 'true' ELSE 'false' END, `updated_at` FROM `app_settings` WHERE `id` = 'current'
UNION ALL
SELECT 'claudeCodeWorkflowsDisabled', CASE WHEN `claude_code_workflows_disabled` THEN 'true' ELSE 'false' END, `updated_at` FROM `app_settings` WHERE `id` = 'current'
UNION ALL
SELECT 'onboardingCompletedAt', json_quote(`onboarding_completed_at`), `updated_at` FROM `app_settings` WHERE `id` = 'current'
UNION ALL
SELECT 'keybindingOverrides', `keybinding_overrides`, `updated_at` FROM `app_settings` WHERE `id` = 'current';
