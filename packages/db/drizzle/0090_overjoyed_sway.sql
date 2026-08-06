PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_queued_thread_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`content` text NOT NULL,
	`sender_thread_id` text,
	`actor_principal_id` text,
	`actor_kind` text,
	`actor_display_name` text,
	`request_id` text,
	`request_fingerprint` text,
	`admission_sequence` integer,
	`model` text NOT NULL,
	`reasoning_level` text NOT NULL,
	`permission_mode` text NOT NULL,
	`service_tier` text NOT NULL,
	`group_with_next` integer DEFAULT false NOT NULL,
	`claimed_at` integer,
	`claim_token` text,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "queued_thread_messages_admission_reference_check" CHECK((
        ("__new_queued_thread_messages"."request_id" IS NULL AND "__new_queued_thread_messages"."request_fingerprint" IS NULL AND "__new_queued_thread_messages"."admission_sequence" IS NULL)
        OR
        ("__new_queued_thread_messages"."request_id" IS NOT NULL AND "__new_queued_thread_messages"."request_fingerprint" IS NOT NULL AND "__new_queued_thread_messages"."admission_sequence" IS NOT NULL)
      ))
);
--> statement-breakpoint
INSERT INTO `__new_queued_thread_messages`("id", "thread_id", "content", "sender_thread_id", "actor_principal_id", "actor_kind", "actor_display_name", "request_id", "request_fingerprint", "admission_sequence", "model", "reasoning_level", "permission_mode", "service_tier", "group_with_next", "claimed_at", "claim_token", "sort_key", "created_at", "updated_at") SELECT "id", "thread_id", "content", "sender_thread_id", "actor_principal_id", "actor_kind", "actor_display_name", NULL, NULL, NULL, "model", "reasoning_level", "permission_mode", "service_tier", 0, "claimed_at", "claim_token", "sort_key", "created_at", "updated_at" FROM `queued_thread_messages`;--> statement-breakpoint
DROP TABLE `queued_thread_messages`;--> statement-breakpoint
ALTER TABLE `__new_queued_thread_messages` RENAME TO `queued_thread_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_created_idx` ON `queued_thread_messages` (`thread_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_sort_idx` ON `queued_thread_messages` (`thread_id`,`sort_key`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `queued_thread_messages_thread_admission_sequence_idx` ON `queued_thread_messages` (`thread_id`,`admission_sequence`);
