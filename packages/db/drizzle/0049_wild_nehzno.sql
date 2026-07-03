CREATE TABLE `plugins` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`root_dir` text NOT NULL,
	`version` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `system_experiments` ADD `plugins` integer DEFAULT false NOT NULL;