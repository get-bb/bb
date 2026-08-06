CREATE TABLE `thread_command_admissions` (
	`thread_id` text NOT NULL,
	`request_id` text NOT NULL,
	`command_kind` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`admission_sequence` integer NOT NULL,
	`actor_principal_id` text NOT NULL,
	`actor_kind` text NOT NULL,
	`actor_display_name` text NOT NULL,
	`result_disposition` text NOT NULL,
	`result_event_sequence` integer,
	`result_queued_message_id` text,
	`result_expected_turn_id` text,
	`created_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `request_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_command_admissions_result_shape_check" CHECK((
        ("thread_command_admissions"."command_kind" = 'message.send' AND "thread_command_admissions"."result_disposition" = 'started' AND "thread_command_admissions"."result_event_sequence" IS NOT NULL AND "thread_command_admissions"."result_queued_message_id" IS NULL AND "thread_command_admissions"."result_expected_turn_id" IS NULL)
        OR
        ("thread_command_admissions"."command_kind" = 'message.send' AND "thread_command_admissions"."result_disposition" = 'queued' AND "thread_command_admissions"."result_queued_message_id" IS NOT NULL AND "thread_command_admissions"."result_event_sequence" IS NULL AND "thread_command_admissions"."result_expected_turn_id" IS NULL)
        OR
        ("thread_command_admissions"."command_kind" = 'message.steer' AND "thread_command_admissions"."result_disposition" = 'steered' AND "thread_command_admissions"."result_event_sequence" IS NOT NULL AND "thread_command_admissions"."result_queued_message_id" IS NULL AND "thread_command_admissions"."result_expected_turn_id" IS NOT NULL)
        OR
        ("thread_command_admissions"."command_kind" = 'thread.interrupt' AND "thread_command_admissions"."result_disposition" = 'interrupted' AND "thread_command_admissions"."result_event_sequence" IS NOT NULL AND "thread_command_admissions"."result_queued_message_id" IS NULL AND "thread_command_admissions"."result_expected_turn_id" IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_command_admissions_thread_sequence_idx` ON `thread_command_admissions` (`thread_id`,`admission_sequence`);