ALTER TABLE `thread_folders` RENAME TO `thread_sections`;--> statement-breakpoint
DROP INDEX `thread_folders_name_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_sections_name_idx` ON `thread_sections` (`name`);--> statement-breakpoint
DROP INDEX `threads_folder_archived_deleted_idx`;--> statement-breakpoint
ALTER TABLE `threads` RENAME COLUMN `folder_id` TO `section_id`;--> statement-breakpoint
CREATE INDEX `threads_section_archived_deleted_idx` ON `threads` (`section_id`,`archived_at`,`deleted_at`,`id`);
