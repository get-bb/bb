CREATE TABLE `thread_execution_owners` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`integration_id` text,
	`plugin_id` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `hosts` ADD `execution_integration` text;