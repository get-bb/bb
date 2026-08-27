CREATE TABLE `dispatch_holds` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`thread_id` text NOT NULL,
	`payload` text NOT NULL,
	`holder` text NOT NULL,
	`user_releasable` integer DEFAULT true NOT NULL,
	`reason` text NOT NULL,
	`resume_at` integer,
	`amend` text,
	`original_request` text,
	`effective_request` text,
	`expected_release_at` integer,
	`stale_after_ms` integer,
	`last_report_at` integer,
	`created_at` integer NOT NULL,
	`released_at` integer,
	`release_kind` text,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dispatch_holds_thread_live_idx` ON `dispatch_holds` (`thread_id`,`created_at`,`id`) WHERE "dispatch_holds"."released_at" IS NULL;--> statement-breakpoint
CREATE INDEX `dispatch_holds_due_release_idx` ON `dispatch_holds` (`resume_at`) WHERE "dispatch_holds"."released_at" IS NULL;--> statement-breakpoint
ALTER TABLE `queued_thread_messages` ADD `plugin_inputs` text;