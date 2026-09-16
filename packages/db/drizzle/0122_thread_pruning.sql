CREATE TABLE `thread_pruning_cursors` (
	`policy` text NOT NULL,
	`scope` text DEFAULT '' NOT NULL,
	`thread_id` text,
	`version` integer NOT NULL,
	`last_thread_id` text DEFAULT '' NOT NULL,
	`current_thread_id` text,
	`step` integer DEFAULT 0 NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`upper_sequence` integer DEFAULT 0 NOT NULL,
	`cycle` integer DEFAULT 0 NOT NULL,
	`latest_root_sequence` integer DEFAULT 0 NOT NULL,
	`latest_context_sequence` integer DEFAULT 0 NOT NULL,
	`probe_event_id` text,
	`probe_phase` integer DEFAULT 0 NOT NULL,
	`probe_sequence` integer DEFAULT 0 NOT NULL,
	`probe_witness_id` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`policy`, `scope`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_pruning_cursors_scope_check" CHECK("thread_pruning_cursors"."scope" = coalesce("thread_pruning_cursors"."thread_id", ''))
);
--> statement-breakpoint
CREATE INDEX `thread_pruning_cursors_thread_idx` ON `thread_pruning_cursors` (`thread_id`);--> statement-breakpoint
CREATE TABLE `thread_pruning_rate_limit_keepers` (
	`provider_id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL
);
