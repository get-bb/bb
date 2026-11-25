CREATE TABLE `project_source_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`project_source_id` text NOT NULL,
	`path` text NOT NULL,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_source_id`) REFERENCES `project_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_source_folders_source_path_idx` ON `project_source_folders` (`project_source_id`,`path`);--> statement-breakpoint
ALTER TABLE `environments` ADD `additional_paths` text DEFAULT '[]' NOT NULL;