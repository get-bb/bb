ALTER TABLE `queued_thread_messages` ADD `send_at` integer;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `waiting_on` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `wait_holder` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `payload_kind` text DEFAULT 'inline' NOT NULL;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `retry_of_turn_request_id` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `retry_attempt` integer;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_due_idx` ON `queued_thread_messages` (`send_at`,`id`) WHERE "queued_thread_messages"."send_at" IS NOT NULL AND "queued_thread_messages"."claimed_at" IS NULL AND "queued_thread_messages"."claim_token" IS NULL;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_wait_holder_idx` ON `queued_thread_messages` (`wait_holder`,`id`) WHERE "queued_thread_messages"."wait_holder" IS NOT NULL;