CREATE TABLE `thread_run_states` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`held_turn_id` text,
	`held_turn_status` text,
	`stop_reason` text,
	`stop_requested_at` integer,
	`stop_sent_at` integer,
	`stop_acked_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_run_states_held_check" CHECK(("thread_run_states"."held_turn_id" IS NULL) = ("thread_run_states"."held_turn_status" IS NULL)),
	CONSTRAINT "thread_run_states_stop_check" CHECK(("thread_run_states"."stop_reason" IS NULL) = ("thread_run_states"."stop_requested_at" IS NULL) AND ("thread_run_states"."stop_sent_at" IS NULL OR "thread_run_states"."stop_requested_at" IS NOT NULL) AND ("thread_run_states"."stop_acked_at" IS NULL OR "thread_run_states"."stop_requested_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `thread_run_states_stop_idx` ON `thread_run_states` (`stop_requested_at`) WHERE "thread_run_states"."stop_requested_at" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `thread_turn_requests` (
	`request_id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`kind` text NOT NULL,
	`phase` text NOT NULL,
	`host_id` text NOT NULL,
	`sync_title` integer DEFAULT false NOT NULL,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `thread_turn_requests_thread_idx` ON `thread_turn_requests` (`thread_id`,`sent_at`);