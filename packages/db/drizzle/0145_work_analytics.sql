CREATE TABLE `telemetry_messages` (
	`analytics_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`accepted_at` integer NOT NULL,
	`trigger` text NOT NULL,
	`message_source` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `telemetry_messages_thread_idx` ON `telemetry_messages` (`thread_id`);--> statement-breakpoint
CREATE TABLE `telemetry_origins` (
	`thread_id` text NOT NULL,
	`kind` text NOT NULL,
	`key` text NOT NULL,
	`message_ids` text NOT NULL,
	PRIMARY KEY(`thread_id`, `kind`, `key`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `telemetry_threads` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`analytics_id` text NOT NULL,
	`pending_request_id` text,
	`active_request_id` text,
	`waiting` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telemetry_threads_analytics_id_unique` ON `telemetry_threads` (`analytics_id`);