CREATE TABLE `thread_plugin_metadata` (
	`thread_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`metadata_json` text NOT NULL,
	PRIMARY KEY(`thread_id`, `plugin_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
