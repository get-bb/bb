ALTER TABLE `thread_folders` RENAME COLUMN "path" TO "name";--> statement-breakpoint
DROP INDEX `thread_folders_path_idx`;--> statement-breakpoint
DROP INDEX `thread_folders_updated_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_folders_name_idx` ON `thread_folders` (`name`);--> statement-breakpoint
ALTER TABLE `threads` ADD `folder_id` text REFERENCES thread_folders(id) ON DELETE SET NULL;--> statement-breakpoint
UPDATE `threads`
SET `folder_id` = (
	SELECT `thread_folders`.`id`
	FROM `thread_folders`
	WHERE `thread_folders`.`name` = `threads`.`folder_path`
)
WHERE `folder_path` IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_folder_archived_deleted_idx` ON `threads` (`folder_id`,`archived_at`,`deleted_at`,`id`);--> statement-breakpoint
ALTER TABLE `threads` DROP COLUMN `folder_path`;
