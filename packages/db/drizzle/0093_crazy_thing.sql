PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_thread_command_admissions` (
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
	`result_interaction_id` text,
	`result_read_cursor` text,
	`created_at` integer NOT NULL,
	`completed_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `request_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_command_admissions_result_shape_check" CHECK((
        ("__new_thread_command_admissions"."command_kind" = 'message.send' AND "__new_thread_command_admissions"."result_disposition" = 'started' AND "__new_thread_command_admissions"."result_event_sequence" IS NOT NULL AND "__new_thread_command_admissions"."result_queued_message_id" IS NULL AND "__new_thread_command_admissions"."result_expected_turn_id" IS NULL AND "__new_thread_command_admissions"."result_interaction_id" IS NULL AND "__new_thread_command_admissions"."result_read_cursor" IS NULL)
        OR
        ("__new_thread_command_admissions"."command_kind" = 'message.send' AND "__new_thread_command_admissions"."result_disposition" = 'queued' AND "__new_thread_command_admissions"."result_queued_message_id" IS NOT NULL AND "__new_thread_command_admissions"."result_event_sequence" IS NULL AND "__new_thread_command_admissions"."result_expected_turn_id" IS NULL AND "__new_thread_command_admissions"."result_interaction_id" IS NULL AND "__new_thread_command_admissions"."result_read_cursor" IS NULL)
        OR
        ("__new_thread_command_admissions"."command_kind" = 'message.steer' AND "__new_thread_command_admissions"."result_disposition" = 'steered' AND "__new_thread_command_admissions"."result_event_sequence" IS NOT NULL AND "__new_thread_command_admissions"."result_queued_message_id" IS NULL AND "__new_thread_command_admissions"."result_expected_turn_id" IS NOT NULL AND "__new_thread_command_admissions"."result_interaction_id" IS NULL AND "__new_thread_command_admissions"."result_read_cursor" IS NULL)
        OR
        ("__new_thread_command_admissions"."command_kind" = 'thread.interrupt' AND "__new_thread_command_admissions"."result_disposition" = 'interrupted' AND "__new_thread_command_admissions"."result_event_sequence" IS NOT NULL AND "__new_thread_command_admissions"."result_queued_message_id" IS NULL AND "__new_thread_command_admissions"."result_expected_turn_id" IS NOT NULL AND "__new_thread_command_admissions"."result_interaction_id" IS NULL AND "__new_thread_command_admissions"."result_read_cursor" IS NULL)
        OR
        ("__new_thread_command_admissions"."command_kind" = 'interaction.answer' AND "__new_thread_command_admissions"."result_disposition" = 'answered' AND "__new_thread_command_admissions"."result_interaction_id" IS NOT NULL AND "__new_thread_command_admissions"."result_event_sequence" IS NULL AND "__new_thread_command_admissions"."result_queued_message_id" IS NULL AND "__new_thread_command_admissions"."result_expected_turn_id" IS NULL AND "__new_thread_command_admissions"."result_read_cursor" IS NULL)
        OR
        ("__new_thread_command_admissions"."command_kind" = 'interaction.approve' AND "__new_thread_command_admissions"."result_disposition" = 'approved' AND "__new_thread_command_admissions"."result_interaction_id" IS NOT NULL AND "__new_thread_command_admissions"."result_event_sequence" IS NULL AND "__new_thread_command_admissions"."result_queued_message_id" IS NULL AND "__new_thread_command_admissions"."result_expected_turn_id" IS NULL AND "__new_thread_command_admissions"."result_read_cursor" IS NULL)
        OR
        ("__new_thread_command_admissions"."command_kind" = 'read.mark' AND "__new_thread_command_admissions"."result_disposition" = 'marked' AND "__new_thread_command_admissions"."result_read_cursor" IS NOT NULL AND "__new_thread_command_admissions"."result_event_sequence" IS NULL AND "__new_thread_command_admissions"."result_queued_message_id" IS NULL AND "__new_thread_command_admissions"."result_expected_turn_id" IS NULL AND "__new_thread_command_admissions"."result_interaction_id" IS NULL)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_thread_command_admissions`("thread_id", "request_id", "command_kind", "request_fingerprint", "admission_sequence", "actor_principal_id", "actor_kind", "actor_display_name", "result_disposition", "result_event_sequence", "result_queued_message_id", "result_expected_turn_id", "result_interaction_id", "result_read_cursor", "created_at", "completed_at") SELECT "thread_id", "request_id", "command_kind", "request_fingerprint", "admission_sequence", "actor_principal_id", "actor_kind", "actor_display_name", "result_disposition", "result_event_sequence", "result_queued_message_id", "result_expected_turn_id", NULL, NULL, "created_at", "completed_at" FROM `thread_command_admissions`;--> statement-breakpoint
DROP TABLE `thread_command_admissions`;--> statement-breakpoint
ALTER TABLE `__new_thread_command_admissions` RENAME TO `thread_command_admissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `thread_command_admissions_thread_sequence_idx` ON `thread_command_admissions` (`thread_id`,`admission_sequence`);