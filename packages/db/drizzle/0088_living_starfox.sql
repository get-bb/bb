DROP INDEX IF EXISTS `environments_host_path_idx`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `environments_project_host_path_idx` ON `environments` (`project_id`,`host_id`,`path`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `environments_host_path_lookup_idx` ON `environments` (`host_id`,`path`);
