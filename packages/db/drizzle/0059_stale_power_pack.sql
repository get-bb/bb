PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pending_interactions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`origin_kind` text DEFAULT 'provider' NOT NULL,
	`turn_id` text,
	`provider_id` text,
	`provider_thread_id` text,
	`provider_request_id` text,
	`plugin_id` text,
	`renderer_id` text,
	`status` text NOT NULL,
	`payload` text NOT NULL,
	`resolution` text,
	`status_reason` text,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	`resolved_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_pending_interactions`("id", "thread_id", "origin_kind", "turn_id", "provider_id", "provider_thread_id", "provider_request_id", "plugin_id", "renderer_id", "status", "payload", "resolution", "status_reason", "created_at", "expires_at", "resolved_at", "updated_at") SELECT "id", "thread_id", 'provider', "turn_id", "provider_id", "provider_thread_id", "provider_request_id", NULL, NULL, "status", "payload", "resolution", "status_reason", "created_at", NULL, "resolved_at", "updated_at" FROM `pending_interactions`;--> statement-breakpoint
DROP TABLE `pending_interactions`;--> statement-breakpoint
ALTER TABLE `__new_pending_interactions` RENAME TO `pending_interactions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `pending_interactions_provider_request_idx` ON `pending_interactions` (`provider_id`,`provider_thread_id`,`provider_request_id`);--> statement-breakpoint
CREATE INDEX `pending_interactions_thread_created_idx` ON `pending_interactions` (`thread_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `pending_interactions_thread_status_created_idx` ON `pending_interactions` (`thread_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `pending_interactions_status_created_idx` ON `pending_interactions` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `pending_interactions_plugin_status_created_idx` ON `pending_interactions` (`plugin_id`,`status`,`created_at`);
