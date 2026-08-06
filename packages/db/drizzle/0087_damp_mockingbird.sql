ALTER TABLE `events` ADD `actor_principal_id` text;--> statement-breakpoint
ALTER TABLE `events` ADD `actor_kind` text;--> statement-breakpoint
ALTER TABLE `events` ADD `actor_display_name` text;--> statement-breakpoint
ALTER TABLE `pending_interactions` ADD `resolution_actor_principal_id` text;--> statement-breakpoint
ALTER TABLE `pending_interactions` ADD `resolution_actor_kind` text;--> statement-breakpoint
ALTER TABLE `pending_interactions` ADD `resolution_actor_display_name` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `actor_principal_id` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `actor_kind` text;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `actor_display_name` text;
