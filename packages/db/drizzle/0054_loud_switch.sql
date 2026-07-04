ALTER TABLE `projects` ADD `run_command` text;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `purpose` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `run_command_project_id` text REFERENCES projects(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `terminal_sessions_run_command_target_idx` ON `terminal_sessions` (`purpose`,`run_command_project_id`,`environment_id`,`status`);
