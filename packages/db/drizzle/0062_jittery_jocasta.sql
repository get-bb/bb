ALTER TABLE `app_settings` ADD `codex_subagents_disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `claude_code_subagents_disabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `app_settings` ADD `claude_code_workflows_disabled` integer DEFAULT false NOT NULL;