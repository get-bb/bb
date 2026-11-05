ALTER TABLE `threads` ADD `status_changed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `threads` SET `status_changed_at` = `updated_at`;
