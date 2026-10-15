CREATE TABLE IF NOT EXISTS `event_cold_chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`seq_start` integer NOT NULL,
	`seq_end` integer NOT NULL,
	`event_count` integer NOT NULL,
	`uncompressed_bytes` integer NOT NULL,
	`codec` text DEFAULT 'zstd-3' NOT NULL,
	`item_ids` text NOT NULL,
	`payload` blob NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "event_cold_chunks_range_check" CHECK("event_cold_chunks"."seq_start" <= "event_cold_chunks"."seq_end" AND "event_cold_chunks"."event_count" > 0)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `event_cold_chunks_thread_seq_idx` ON `event_cold_chunks` (`thread_id`,`seq_start`,`seq_end`);