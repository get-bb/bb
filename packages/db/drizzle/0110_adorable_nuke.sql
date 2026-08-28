CREATE TABLE `thread_retention_schedules` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`archived_at` integer NOT NULL,
	`conversation_delete_due_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `thread_retention_conversation_due_idx` ON `thread_retention_schedules` (`conversation_delete_due_at`);