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
	`reasoning_level` text NOT NULL,
	`permission_mode` text NOT NULL,
	`service_tier` text NOT NULL,
	`group_with_next` integer DEFAULT false NOT NULL,
	`state` text NOT NULL,
	`submitted_request_id` text,
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
	`delivery_mode` text DEFAULT 'steer' NOT NULL,
	`coalesce_key` text,
	`coalesce_state` text,
	`claimed_at` integer,
	`claim_token` text,
	`edit_held_until` integer,
	`sort_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "queued_thread_messages_state_check" CHECK(CASE "state"
        WHEN 'submitted' THEN "claimed_at" IS NULL AND "failure_reason" IS NULL AND "send_at" IS NULL AND "waiting_on" IS NULL
        WHEN 'claimed' THEN "claimed_at" IS NOT NULL
        WHEN 'failed_retrying' THEN "claimed_at" IS NULL AND "failure_reason" IS NOT NULL AND "next_attempt_at" IS NOT NULL
        WHEN 'failed_exhausted' THEN "claimed_at" IS NULL AND "failure_reason" IS NOT NULL AND "next_attempt_at" IS NULL
        WHEN 'scheduled' THEN "claimed_at" IS NULL AND "failure_reason" IS NULL AND "send_at" IS NOT NULL
        WHEN 'waiting' THEN "claimed_at" IS NULL AND "failure_reason" IS NULL AND "send_at" IS NULL AND "waiting_on" IS NOT NULL
        WHEN 'queued' THEN "claimed_at" IS NULL AND "failure_reason" IS NULL AND "send_at" IS NULL AND "waiting_on" IS NULL
        ELSE 0
      END),
	CONSTRAINT "queued_thread_messages_submitted_check" CHECK(("submitted_request_id" IS NOT NULL) = ("state" = 'submitted')),
	CONSTRAINT "queued_thread_messages_claim_check" CHECK(("claimed_at" IS NULL) = ("claim_token" IS NULL)),
	CONSTRAINT "queued_thread_messages_failure_check" CHECK(("failure_reason" IS NULL AND "failure_count" = 0 AND "next_attempt_at" IS NULL)
        OR ("failure_reason" IS NOT NULL AND "failure_count" > 0)),
	CONSTRAINT "queued_thread_messages_schedule_check" CHECK("send_at" IS NULL OR "waiting_on" IS NOT NULL),
	CONSTRAINT "queued_thread_messages_wait_holder_check" CHECK("wait_holder" IS (CASE WHEN json_extract("waiting_on", '$.kind') = 'plugin' THEN 'plugin:' || json_extract("waiting_on", '$.pluginId') END))
);
--> statement-breakpoint
INSERT INTO `__new_queued_thread_messages`("id", "system_notice", "thread_id", "content", "sender_thread_id", "origin", "origin_plugin_id", "requested_by_initiator", "requested_by_thread_id", "model", "reasoning_level", "permission_mode", "service_tier", "group_with_next", "state", "submitted_request_id", "send_at", "waiting_on", "wait_holder", "failure_reason", "failure_count", "next_attempt_at", "payload_kind", "retry_of_turn_request_id", "retry_attempt", "retry_reason", "delivery_mode", "coalesce_key", "coalesce_state", "claimed_at", "claim_token", "edit_held_until", "sort_key", "created_at", "updated_at") SELECT "id", "system_notice", "thread_id", "content", "sender_thread_id", "origin", "origin_plugin_id", "requested_by_initiator", "requested_by_thread_id", "model", "reasoning_level", "permission_mode", "service_tier", "group_with_next", "state", NULL, "send_at", "waiting_on", "wait_holder", "failure_reason", "failure_count", "next_attempt_at", "payload_kind", "retry_of_turn_request_id", "retry_attempt", "retry_reason", "delivery_mode", "coalesce_key", "coalesce_state", "claimed_at", "claim_token", "edit_held_until", "sort_key", "created_at", "updated_at" FROM `queued_thread_messages`;--> statement-breakpoint
DROP TABLE `queued_thread_messages`;--> statement-breakpoint
ALTER TABLE `__new_queued_thread_messages` RENAME TO `queued_thread_messages`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_created_idx` ON `queued_thread_messages` (`thread_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `queued_thread_messages_thread_sort_idx` ON `queued_thread_messages` (`thread_id`,`sort_key`,`id`);--> statement-breakpoint
CREATE INDEX `queued_thread_messages_due_idx` ON `queued_thread_messages` (`state`,`send_at`,`id`);--> statement-breakpoint
CREATE INDEX `queued_thread_messages_retry_idx` ON `queued_thread_messages` (`state`,`next_attempt_at`,`id`);--> statement-breakpoint
CREATE INDEX `queued_thread_messages_coalesce_idx` ON `queued_thread_messages` (`thread_id`,`coalesce_key`) WHERE "queued_thread_messages"."coalesce_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_submitted_request_idx` ON `queued_thread_messages` (`thread_id`,`submitted_request_id`) WHERE "queued_thread_messages"."submitted_request_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_wait_holder_idx` ON `queued_thread_messages` (`wait_holder`,`id`) WHERE "queued_thread_messages"."wait_holder" IS NOT NULL;