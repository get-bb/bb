CREATE TABLE `retained_event_outputs` (
	`event_id` text PRIMARY KEY NOT NULL,
	`output_path` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `retained_event_outputs_expiry_idx` ON `retained_event_outputs` (`expires_at`,`event_id`);