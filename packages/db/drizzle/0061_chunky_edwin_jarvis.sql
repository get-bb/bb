CREATE TABLE IF NOT EXISTS `thread_tabs` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`tabs_json` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
