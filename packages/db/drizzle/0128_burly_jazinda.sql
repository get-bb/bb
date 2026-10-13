ALTER TABLE `queued_thread_messages` ADD `failure_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `next_attempt_at` integer;