CREATE TABLE `environment_setup_outcomes` (
	`host_id` text NOT NULL,
	`path` text NOT NULL,
	`operation_id` text NOT NULL,
	`state` text NOT NULL,
	`input_hash` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`host_id`, `path`),
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
