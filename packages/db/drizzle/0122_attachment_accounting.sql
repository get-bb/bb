CREATE TABLE `project_attachment_backfills` (
	`project_id` text PRIMARY KEY NOT NULL,
	`phase` text NOT NULL,
	`thread_cursor` text NOT NULL,
	`input_cursor` integer NOT NULL,
	`input_id` text NOT NULL,
	`input_sequence` integer NOT NULL,
	`attempted_at` integer NOT NULL,
	`error` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `project_attachment_threads` (
	`attachment_id` text NOT NULL,
	`thread_id` text NOT NULL,
	PRIMARY KEY(`attachment_id`, `thread_id`),
	FOREIGN KEY (`attachment_id`) REFERENCES `project_attachments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `project_attachment_threads_thread_idx` ON `project_attachment_threads` (`thread_id`);--> statement-breakpoint
CREATE TABLE `project_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stored_path` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	`deletion_claimed_at` integer,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_attachments_size_check" CHECK("project_attachments"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `project_attachments_project_path_idx` ON `project_attachments` (`project_id`,`stored_path`);--> statement-breakpoint
CREATE INDEX `project_attachments_project_created_idx` ON `project_attachments` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `project_attachments_deletion_idx` ON `project_attachments` (`project_id`,`deletion_claimed_at`,`id`) WHERE "project_attachments"."deletion_claimed_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_project_id_idx` ON `threads` (`project_id`,`id`);