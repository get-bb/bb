DROP INDEX IF EXISTS `thread_search_segments_thread_idx`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_search_segments_thread_source_seq_idx` ON `thread_search_segments` (`thread_id`,`source_seq`);
