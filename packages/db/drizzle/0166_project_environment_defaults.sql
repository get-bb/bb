CREATE TABLE `project_environment_defaults` (
	`project_id` text PRIMARY KEY NOT NULL,
	`environment_provider_id` text NOT NULL,
	`inputs` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
