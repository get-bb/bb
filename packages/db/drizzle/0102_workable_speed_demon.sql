ALTER TABLE `environments` ADD `base_revision` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `base_revision_verified_at` integer;--> statement-breakpoint
ALTER TABLE `environments` ADD `provision_failure` text;--> statement-breakpoint
ALTER TABLE `work_together_room_resource_reservations` ADD `base_revision` text;--> statement-breakpoint
ALTER TABLE `work_together_room_resource_reservations` ADD `bb_host_id` text;--> statement-breakpoint
ALTER TABLE `work_together_room_resource_reservations` ADD `project_name` text;--> statement-breakpoint
ALTER TABLE `work_together_room_resource_reservations` ADD `provider_id` text;--> statement-breakpoint
ALTER TABLE `work_together_room_resource_reservations` ADD `source_path` text;