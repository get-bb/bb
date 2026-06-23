CREATE TABLE `thread_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_folders_path_idx` ON `thread_folders` (`path`);--> statement-breakpoint
CREATE INDEX `thread_folders_updated_idx` ON `thread_folders` (`updated_at`);--> statement-breakpoint
ALTER TABLE `threads` ADD `folder_path` text;