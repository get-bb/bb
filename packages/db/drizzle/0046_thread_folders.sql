CREATE TABLE `thread_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_folders_name_idx` ON `thread_folders` (`name`);--> statement-breakpoint
ALTER TABLE `threads` ADD `folder_id` text REFERENCES thread_folders(id) ON DELETE SET NULL;--> statement-breakpoint
CREATE INDEX `threads_folder_archived_deleted_idx` ON `threads` (`folder_id`,`archived_at`,`deleted_at`,`id`);
