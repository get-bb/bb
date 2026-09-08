CREATE TABLE `machine_workspace_setups` (
	`host_id` text NOT NULL,
	`path` text NOT NULL,
	`stamp` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`host_id`, `path`),
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
