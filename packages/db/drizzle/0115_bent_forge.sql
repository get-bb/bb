ALTER TABLE `hosts` ADD `removal_started_at` integer;--> statement-breakpoint
ALTER TABLE `machine_launches` ADD `cleanup_retry_at` integer;