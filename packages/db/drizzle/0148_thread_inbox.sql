CREATE TABLE IF NOT EXISTS `thread_inbox_receipts` (
	`thread_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`queued_message_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `idempotency_key`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_inbox_receipts_created_idx` ON `thread_inbox_receipts` (`created_at`);--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `delivery_mode` text DEFAULT 'steer' NOT NULL;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `coalesce_key` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `coalesce_state` text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `queued_thread_messages_coalesce_idx` ON `queued_thread_messages` (`thread_id`,`coalesce_key`) WHERE "queued_thread_messages"."coalesce_key" IS NOT NULL;