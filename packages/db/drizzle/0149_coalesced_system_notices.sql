ALTER TABLE `queued_thread_messages` ADD `coalesce_key` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `coalesce_state` text;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_coalesce_idx` ON `queued_thread_messages` (`thread_id`,`coalesce_key`) WHERE "queued_thread_messages"."coalesce_key" IS NOT NULL;