ALTER TABLE `threads` ADD `lifecycle_owner_thread_id` text REFERENCES threads(id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX `threads_lifecycle_owner_idx` ON `threads` (`lifecycle_owner_thread_id`);
