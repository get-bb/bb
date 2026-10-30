CREATE TABLE IF NOT EXISTS `project_default_environments` (
	`project_id` text PRIMARY KEY NOT NULL,
	`environment_provider_id` text NOT NULL,
	`selection` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
