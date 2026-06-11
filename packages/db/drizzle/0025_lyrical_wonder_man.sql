ALTER TABLE `workflow_runs` ADD `archived_at` integer;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `deleted_at` integer;--> statement-breakpoint
CREATE INDEX `workflow_runs_created_idx` ON `workflow_runs` (`created_at`);