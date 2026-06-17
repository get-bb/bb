PRAGMA foreign_keys=OFF;--> statement-breakpoint
DROP TABLE IF EXISTS `automations`;--> statement-breakpoint
DROP TABLE IF EXISTS `thread_schedules`;--> statement-breakpoint
CREATE TABLE `__new_threads` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text,
	`provider_id` text NOT NULL,
	`model_override` text,
	`reasoning_level_override` text,
	`title` text,
	`title_fallback` text,
	`status` text DEFAULT 'starting' NOT NULL,
	`parent_thread_id` text,
	`archived_at` integer,
	`pinned_at` integer,
	`pin_sort_key` text,
	`deleted_at` integer,
	`last_read_at` integer,
	`latest_attention_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_threads`("id", "project_id", "environment_id", "provider_id", "model_override", "reasoning_level_override", "title", "title_fallback", "status", "parent_thread_id", "archived_at", "pinned_at", "pin_sort_key", "deleted_at", "last_read_at", "latest_attention_at", "created_at", "updated_at") SELECT "id", "project_id", "environment_id", "provider_id", "model_override", "reasoning_level_override", "title", "title_fallback", "status", "parent_thread_id", "archived_at", "pinned_at", "pin_sort_key", "deleted_at", "last_read_at", "latest_attention_at", "created_at", "updated_at" FROM `threads`;--> statement-breakpoint
DROP TABLE `threads`;--> statement-breakpoint
ALTER TABLE `__new_threads` RENAME TO `threads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `threads_project_updated_idx` ON `threads` (`project_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `threads_project_archived_deleted_idx` ON `threads` (`project_id`,`archived_at`,`deleted_at`,`id`);--> statement-breakpoint
CREATE INDEX `threads_pin_sort_idx` ON `threads` (`archived_at`,`deleted_at`,`pin_sort_key`,`id`) WHERE "threads"."pinned_at" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `threads_environment_idx` ON `threads` (`environment_id`);--> statement-breakpoint
CREATE INDEX `threads_parent_idx` ON `threads` (`parent_thread_id`);--> statement-breakpoint
CREATE INDEX `threads_archived_status_idx` ON `threads` (`archived_at`,`status`);--> statement-breakpoint
CREATE INDEX `threads_environment_archived_deleted_idx` ON `threads` (`environment_id`,`archived_at`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `threads_active_maintenance_idx` ON `threads` (`status`) WHERE "threads"."deleted_at" IS NULL;
