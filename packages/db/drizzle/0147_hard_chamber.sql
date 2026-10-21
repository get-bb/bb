CREATE TABLE IF NOT EXISTS `holdout_assignments` (
	`key` text PRIMARY KEY NOT NULL,
	`arm` text NOT NULL,
	`assigned_at` integer NOT NULL,
	`app_version` text NOT NULL,
	`exposed_at` integer
);
