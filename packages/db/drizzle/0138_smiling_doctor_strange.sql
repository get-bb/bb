CREATE TABLE `plugin_timeline_events` (
	`thread_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`id` text NOT NULL,
	`request_event_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_sequence` integer NOT NULL,
	`renderer_id` text NOT NULL,
	`payload_json` text NOT NULL,
	`presentation_json` text NOT NULL,
	`status` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `plugin_id`, `id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`request_event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plugin_timeline_events_request_idx` ON `plugin_timeline_events` (`thread_id`,`request_sequence`);--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `timeline_event_json` text;