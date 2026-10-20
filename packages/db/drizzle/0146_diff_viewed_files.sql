CREATE TABLE IF NOT EXISTS `diff_viewed_files` (
	`environment_id` text NOT NULL,
	`target_key` text NOT NULL,
	`path` text NOT NULL,
	`revision` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`environment_id`, `target_key`, `path`),
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
