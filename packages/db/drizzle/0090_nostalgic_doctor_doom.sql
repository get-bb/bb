CREATE TABLE `environment_provision_requests` (
	`environment_id` text PRIMARY KEY NOT NULL,
	`request_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade
);
