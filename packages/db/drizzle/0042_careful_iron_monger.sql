CREATE TABLE `app_theme` (
	`id` text PRIMARY KEY NOT NULL,
	`theme_id` text NOT NULL,
	`custom_css` text,
	`updated_at` integer NOT NULL
);
