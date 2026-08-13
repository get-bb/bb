CREATE TABLE IF NOT EXISTS `thread_handoffs` (
	`id` text PRIMARY KEY NOT NULL,
	`replacement_thread_id` text NOT NULL,
	`source_thread_id` text NOT NULL,
	`project_id` text NOT NULL,
	`environment_id` text,
	`provider_id` text NOT NULL,
	`model` text NOT NULL,
	`reasoning_level` text NOT NULL,
	`service_tier` text,
	`permission_mode` text NOT NULL,
	`archive_source` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`failure_code` text,
	`failure_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`settled_at` integer,
	FOREIGN KEY (`replacement_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "thread_handoffs_settlement_shape_check" CHECK((
        (
          "thread_handoffs"."status" = 'provisioning'
          AND "thread_handoffs"."settled_at" IS NULL
          AND "thread_handoffs"."failure_code" IS NULL
          AND "thread_handoffs"."failure_message" IS NULL
        )
        OR
        (
          "thread_handoffs"."status" = 'started'
          AND "thread_handoffs"."settled_at" IS NOT NULL
          AND "thread_handoffs"."failure_code" IS NULL
          AND "thread_handoffs"."failure_message" IS NULL
        )
        OR
        (
          "thread_handoffs"."status" = 'failed'
          AND "thread_handoffs"."settled_at" IS NOT NULL
          AND length("thread_handoffs"."failure_code") > 0
          AND length("thread_handoffs"."failure_message") > 0
        )
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `thread_handoffs_replacement_idx` ON `thread_handoffs` (`replacement_thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `thread_handoffs_source_idempotency_idx` ON `thread_handoffs` (`source_thread_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_handoffs_project_idx` ON `thread_handoffs` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_handoffs_environment_idx` ON `thread_handoffs` (`environment_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_handoffs_provisioning_page_idx` ON `thread_handoffs` (`status`,`created_at`,`id`);
