DELETE FROM `maintenance_scan_cursors` WHERE `policy` = 'completed_event_output_truncation';
--> statement-breakpoint
DELETE FROM `thread_pruning_cursors`
  WHERE `thread_id` IN (SELECT `id` FROM `threads` WHERE `archived_at` IS NOT NULL);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `terminal_sessions_exited_prune_idx` ON `terminal_sessions` (`updated_at`,`id`) WHERE "terminal_sessions"."status" = 'exited';
