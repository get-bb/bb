CREATE TABLE IF NOT EXISTS `thread_turn_timeline_plans` (
	`thread_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`projection_key` text NOT NULL,
	`watermark` integer NOT NULL,
	`plan_json` text NOT NULL,
	PRIMARY KEY(`thread_id`, `turn_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
