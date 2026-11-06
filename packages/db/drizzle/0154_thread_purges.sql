CREATE TABLE IF NOT EXISTS `thread_purges` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`requested_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_purges_requested_idx` ON `thread_purges` (`requested_at`);