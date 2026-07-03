CREATE TABLE `plugin_schedules` (
	`plugin_id` text NOT NULL,
	`name` text NOT NULL,
	`cron` text NOT NULL,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer,
	`last_status` text,
	`last_error` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`plugin_id`, `name`)
);
