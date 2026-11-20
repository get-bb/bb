ALTER TABLE `queued_thread_messages` ADD `recheck_at` integer;--> statement-breakpoint
CREATE INDEX `queued_thread_messages_recheck_idx` ON `queued_thread_messages` (`state`,`recheck_at`,`id`) WHERE "queued_thread_messages"."recheck_at" IS NOT NULL;--> statement-breakpoint
UPDATE `queued_thread_messages` SET `recheck_at` = `send_at`, `send_at` = NULL, `state` = CASE WHEN `state` = 'scheduled' THEN 'waiting' ELSE `state` END WHERE `wait_holder` IS NOT NULL AND `send_at` IS NOT NULL;
