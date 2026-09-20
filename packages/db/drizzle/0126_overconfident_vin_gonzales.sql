ALTER TABLE `queued_thread_messages` ADD `origin` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `origin_plugin_id` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `requested_by_initiator` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `requested_by_thread_id` text;