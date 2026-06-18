CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`run_mode` text NOT NULL,
	`thread_id` text,
	`status` text NOT NULL,
	`trigger` text NOT NULL,
	`skip_reason` text,
	`error` text,
	`output` text,
	`exit_code` integer,
	`idempotency_key` text,
	`scheduled_for` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automation_runs_automation_started_idx` ON `automation_runs` (`automation_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `automation_runs_thread_idx` ON `automation_runs` (`thread_id`);--> statement-breakpoint
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_thread_id` text,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`trigger_type` text NOT NULL,
	`trigger_config` text NOT NULL,
	`run_mode` text NOT NULL,
	`execution` text NOT NULL,
	`environment` text NOT NULL,
	`auto_archive` integer DEFAULT false NOT NULL,
	`origin` text NOT NULL,
	`created_by_thread_id` text,
	`next_run_at` integer,
	`last_run_at` integer,
	`run_count` integer DEFAULT 0 NOT NULL,
	`last_run_status` text,
	`last_run_thread_id` text,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`target_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `automations_project_idx` ON `automations` (`project_id`);--> statement-breakpoint
CREATE INDEX `automations_due_idx` ON `automations` (`enabled`,`trigger_type`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `automations_target_thread_idx` ON `automations` (`target_thread_id`);