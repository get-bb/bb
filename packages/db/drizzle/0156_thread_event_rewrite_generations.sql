CREATE TABLE IF NOT EXISTS `thread_event_rewrite_generations` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`generation` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
