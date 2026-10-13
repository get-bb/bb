ALTER TABLE `threads` ADD `status_changed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `threads` ADD `awaiting_user_reply` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `threads` SET `status_changed_at` = `updated_at`;