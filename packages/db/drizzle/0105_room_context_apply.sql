CREATE TABLE `work_together_room_context_applies` (
	`binding_id` text NOT NULL,
	`request_id` text NOT NULL,
	`context_version` integer NOT NULL,
	`digest` text NOT NULL,
	`bytes` blob NOT NULL,
	`admission_sequence` integer NOT NULL,
	`created_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	PRIMARY KEY(`binding_id`, `request_id`),
	FOREIGN KEY (`binding_id`) REFERENCES `work_together_room_resource_reservations`(`binding_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_context_binding_version_idx` ON `work_together_room_context_applies` (`binding_id`,`context_version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_context_binding_sequence_idx` ON `work_together_room_context_applies` (`binding_id`,`admission_sequence`);
--> statement-breakpoint
CREATE TABLE `work_together_room_stream_contexts` (
	`binding_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`context_version` integer NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`binding_id`, `thread_id`),
	FOREIGN KEY (`binding_id`) REFERENCES `work_together_room_resource_reservations`(`binding_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_stream_context_thread_idx` ON `work_together_room_stream_contexts` (`thread_id`);
