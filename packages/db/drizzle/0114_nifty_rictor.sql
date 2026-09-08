CREATE TABLE `environment_hook_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`host_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`error` text
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_environment_launches` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`phase` text NOT NULL,
	`started_at` integer NOT NULL,
	`failed_at` integer,
	`failure` text,
	`message` text,
	`transient_failures` integer NOT NULL,
	`path_key` text NOT NULL,
	`host_id` text,
	`path` text,
	`claim_path` text,
	`owns_path` integer DEFAULT false NOT NULL,
	`merge_base_branch` text,
	`resource` text,
	`step_text` text NOT NULL,
	`pending_log` text NOT NULL,
	`replaced_environment_id` text,
	`environment_id` text,
	`selection` text NOT NULL,
	`request` text,
	`cancel_pending` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_environment_launches`("thread_id", "provider_id", "attempt", "phase", "started_at", "failed_at", "failure", "message", "transient_failures", "path_key", "host_id", "path", "claim_path", "owns_path", "merge_base_branch", "resource", "step_text", "pending_log", "replaced_environment_id", "environment_id", "selection", "request", "cancel_pending") SELECT "thread_id", "provider_id", "attempt", "phase", "started_at", "failed_at", "failure", "message", "transient_failures", "path_key", "host_id", "path", "claim_path", "owns_path", "merge_base_branch", "resource", "step_text", "pending_log", "replaced_environment_id", "environment_id", "selection", "request", "cancel_pending" FROM `environment_launches`;--> statement-breakpoint
DROP TABLE `environment_launches`;--> statement-breakpoint
ALTER TABLE `__new_environment_launches` RENAME TO `environment_launches`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `environment_launches_phase_idx` ON `environment_launches` (`phase`);