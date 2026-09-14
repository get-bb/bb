CREATE TABLE `ui_preferences` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
