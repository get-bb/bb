ALTER TABLE `threads` ADD `source_thread_id` text REFERENCES `threads`(`id`) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `threads` ADD `origin_kind` text;
--> statement-breakpoint
UPDATE `threads`
SET
  `source_thread_id` = `parent_thread_id`,
  `origin_kind` = `child_origin`,
  `parent_thread_id` = NULL,
  `child_origin` = NULL
WHERE `child_origin` IS NOT NULL;
--> statement-breakpoint
CREATE INDEX `threads_source_origin_idx` ON `threads` (`source_thread_id`, `origin_kind`);
