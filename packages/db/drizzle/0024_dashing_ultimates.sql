CREATE TABLE `project_workflow_policies` (
	`project_id` text PRIMARY KEY NOT NULL,
	`sandbox_ceiling` text NOT NULL,
	`default_budget_output_tokens` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workflow_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`agent_index` integer,
	`producer_event_id` text NOT NULL,
	`producer_event_payload_hash` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_run_events_run_sequence_idx` ON `workflow_run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_run_events_producer_event_id_idx` ON `workflow_run_events` (`producer_event_id`);--> statement-breakpoint
CREATE INDEX `workflow_run_events_run_agent_sequence_idx` ON `workflow_run_events` (`run_id`,`agent_index`,`sequence`);--> statement-breakpoint
CREATE TABLE `workflow_run_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`payload` text NOT NULL,
	`command_id` text,
	`requested_at` integer NOT NULL,
	`queued_at` integer,
	`completed_at` integer,
	`failure_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_run_operations_run_kind_idx` ON `workflow_run_operations` (`run_id`,`kind`);--> statement-breakpoint
CREATE INDEX `workflow_run_operations_state_idx` ON `workflow_run_operations` (`state`);--> statement-breakpoint
CREATE INDEX `workflow_run_operations_run_idx` ON `workflow_run_operations` (`run_id`);--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`host_id` text NOT NULL,
	`workspace_path` text NOT NULL,
	`anchor_thread_id` text,
	`client_request_id` text,
	`workflow_name` text NOT NULL,
	`source_tier` text NOT NULL,
	`script_source` text NOT NULL,
	`script_hash` text NOT NULL,
	`args_json` text,
	`seed` integer NOT NULL,
	`key_version` text NOT NULL,
	`provider_id` text NOT NULL,
	`model` text,
	`effort` text NOT NULL,
	`sandbox` text NOT NULL,
	`sandbox_ceiling` text DEFAULT 'workspace-write' NOT NULL,
	`concurrency` integer NOT NULL,
	`max_agents` integer NOT NULL,
	`max_fanout` integer NOT NULL,
	`budget_output_tokens` integer,
	`status` text NOT NULL,
	`failure_reason` text,
	`pending_manager_notification` text,
	`progress_snapshot` text,
	`usage_input_tokens` integer DEFAULT 0 NOT NULL,
	`usage_output_tokens` integer DEFAULT 0 NOT NULL,
	`usage_tool_uses` integer DEFAULT 0 NOT NULL,
	`usage_duration_ms` integer DEFAULT 0 NOT NULL,
	`result_json` text,
	`retention` text NOT NULL,
	`run_dir_pruned_at` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`settled_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`anchor_thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workflow_runs_project_created_idx` ON `workflow_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_runs_host_status_idx` ON `workflow_runs` (`host_id`,`status`);--> statement-breakpoint
CREATE INDEX `workflow_runs_host_prune_idx` ON `workflow_runs` (`host_id`,`retention`,`run_dir_pruned_at`);--> statement-breakpoint
CREATE INDEX `workflow_runs_anchor_thread_idx` ON `workflow_runs` (`anchor_thread_id`);--> statement-breakpoint
CREATE INDEX `workflow_runs_pending_notification_idx` ON `workflow_runs` (`pending_manager_notification`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_runs_client_request_id_idx` ON `workflow_runs` (`client_request_id`);