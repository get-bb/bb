PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_queued_thread_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`system_notice` text,
	`thread_id` text NOT NULL,
	`content` text NOT NULL,
	`sender_thread_id` text,
	`origin` text,
	`origin_plugin_id` text,
	`requested_by_initiator` text,
	`requested_by_thread_id` text,
	`model` text NOT NULL,
	`reasoning_level` text,
	`permission_mode` text NOT NULL,
	`service_tier` text NOT NULL,
	`group_with_next` integer DEFAULT false NOT NULL,
	`send_at` integer,
	`waiting_on` text,
	`wait_holder` text,
	`failure_reason` text,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer,
	`payload_kind` text DEFAULT 'inline' NOT NULL,
	`retry_of_turn_request_id` text,
	`retry_attempt` integer,
	`retry_reason` text,
	`claimed_at` integer,
	`claim_token` text,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_queued_thread_messages`("id", "system_notice", "thread_id", "content", "sender_thread_id", "origin", "origin_plugin_id", "requested_by_initiator", "requested_by_thread_id", "model", "reasoning_level", "permission_mode", "service_tier", "send_at", "waiting_on", "wait_holder", "failure_reason", "failure_count", "next_attempt_at", "payload_kind", "retry_of_turn_request_id", "retry_attempt", "retry_reason", "claimed_at", "claim_token", "sort_key", "created_at", "updated_at") SELECT "id", "system_notice", "thread_id", "content", "sender_thread_id", "origin", "origin_plugin_id", "requested_by_initiator", "requested_by_thread_id", "model", "reasoning_level", "permission_mode", "service_tier", "send_at", "waiting_on", "wait_holder", "failure_reason", "failure_count", "next_attempt_at", "payload_kind", "retry_of_turn_request_id", "retry_attempt", "retry_reason", "claimed_at", "claim_token", "sort_key", "created_at", "updated_at" FROM `queued_thread_messages`;--> statement-breakpoint
DROP TABLE `queued_thread_messages`;--> statement-breakpoint
ALTER TABLE `__new_queued_thread_messages` RENAME TO `queued_thread_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_created_idx` ON `queued_thread_messages` (`thread_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_sort_idx` ON `queued_thread_messages` (`thread_id`,`sort_key`,`id`);--> statement-breakpoint
CREATE INDEX `queued_thread_messages_due_idx` ON `queued_thread_messages` (`send_at`,`id`) WHERE "queued_thread_messages"."send_at" IS NOT NULL AND "queued_thread_messages"."claimed_at" IS NULL AND "queued_thread_messages"."claim_token" IS NULL;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_wait_holder_idx` ON `queued_thread_messages` (`wait_holder`,`id`) WHERE "queued_thread_messages"."wait_holder" IS NOT NULL;
