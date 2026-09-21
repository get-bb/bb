CREATE TABLE `thread_image_metadata` (
	`thread_id` text NOT NULL,
	`source` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`etag` text,
	PRIMARY KEY(`thread_id`, `source`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
