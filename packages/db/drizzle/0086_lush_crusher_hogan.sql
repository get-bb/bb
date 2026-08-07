CREATE TABLE `project_workspace_settings` (
	`project_id` text PRIMARY KEY NOT NULL,
	`setup_script` text,
	`run_script` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
