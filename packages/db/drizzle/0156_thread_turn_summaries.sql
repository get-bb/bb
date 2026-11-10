CREATE TABLE IF NOT EXISTS `thread_turn_summaries` (
	`thread_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`projection_key` text NOT NULL,
	`validated_through` integer NOT NULL,
	`summary_json` text NOT NULL,
	PRIMARY KEY(`thread_id`, `turn_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
