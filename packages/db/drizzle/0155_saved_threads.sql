CREATE TABLE IF NOT EXISTS `saved_threads` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`state` text NOT NULL,
	`title` text,
	`provider_id` text NOT NULL,
	`thread_created_at` integer NOT NULL,
	`archived_at` integer,
	`format_version` integer NOT NULL,
	`through_sequence` integer NOT NULL,
	`row_count` integer NOT NULL,
	`raw_bytes` integer NOT NULL,
	`packed_bytes` integer NOT NULL,
	`saved_at` integer,
	`restored_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `saved_threads_state_idx` ON `saved_threads` (`state`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `saved_threads_project_saved_idx` ON `saved_threads` (`project_id`,`saved_at`);