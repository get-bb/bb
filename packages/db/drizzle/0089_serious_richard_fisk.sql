CREATE TABLE IF NOT EXISTS `provider_session_reservations` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_session_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `provider_session_reservations_session_idx` ON `provider_session_reservations` (`host_id`,`provider_id`,`provider_session_id`);