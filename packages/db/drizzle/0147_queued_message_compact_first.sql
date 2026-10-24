ALTER TABLE `queued_thread_messages` ADD `compact_first` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `send_now` integer DEFAULT false NOT NULL;