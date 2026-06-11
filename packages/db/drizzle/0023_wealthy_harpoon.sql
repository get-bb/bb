DELETE FROM `project_execution_defaults`
WHERE `thread_type` <> 'standard';--> statement-breakpoint
DROP INDEX `project_execution_defaults_project_thread_type_idx`;--> statement-breakpoint
DROP INDEX `project_execution_defaults_project_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX `project_execution_defaults_project_idx` ON `project_execution_defaults` (`project_id`);--> statement-breakpoint
ALTER TABLE `project_execution_defaults` DROP COLUMN `thread_type`;--> statement-breakpoint
DROP INDEX `threads_project_type_sort_idx`;--> statement-breakpoint
ALTER TABLE `threads` DROP COLUMN `type`;--> statement-breakpoint
ALTER TABLE `threads` DROP COLUMN `sort_key`;
