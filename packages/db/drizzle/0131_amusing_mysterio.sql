DROP INDEX IF EXISTS `project_execution_defaults_project_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `project_execution_defaults_project_provider_idx` ON `project_execution_defaults` (`project_id`,`provider_id`);
