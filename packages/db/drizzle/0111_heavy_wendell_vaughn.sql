PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_thread_retention_schedules` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`host_id` text,
	`archived_at` integer,
	`resource_cleanup_due_at` integer,
	`conversation_delete_due_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "thread_retention_resource_host_check" CHECK("__new_thread_retention_schedules"."resource_cleanup_due_at" IS NULL OR "__new_thread_retention_schedules"."host_id" IS NOT NULL),
	CONSTRAINT "thread_retention_deadline_check" CHECK("__new_thread_retention_schedules"."resource_cleanup_due_at" IS NOT NULL OR "__new_thread_retention_schedules"."conversation_delete_due_at" IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_thread_retention_schedules`("thread_id", "host_id", "archived_at", "resource_cleanup_due_at", "conversation_delete_due_at", "created_at", "updated_at") SELECT "thread_id", NULL, "archived_at", NULL, "conversation_delete_due_at", "created_at", "updated_at" FROM `thread_retention_schedules`;--> statement-breakpoint
DROP TABLE `thread_retention_schedules`;--> statement-breakpoint
ALTER TABLE `__new_thread_retention_schedules` RENAME TO `thread_retention_schedules`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `thread_retention_resource_due_idx` ON `thread_retention_schedules` (`resource_cleanup_due_at`);--> statement-breakpoint
CREATE INDEX `thread_retention_conversation_due_idx` ON `thread_retention_schedules` (`conversation_delete_due_at`);
