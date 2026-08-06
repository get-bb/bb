CREATE TABLE `work_together_room_resource_reservations` (
	`binding_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`cell_id` text NOT NULL,
	`repository_binding_id` text NOT NULL,
	`repository_binding_version` integer NOT NULL,
	`provider_repository_id` text NOT NULL,
	`base_branch` text NOT NULL,
	`generated_branch` text NOT NULL,
	`candidate_host_id` text NOT NULL,
	`environment_template` text NOT NULL,
	`project_id` text NOT NULL,
	`project_source_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`primary_thread_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "wt_room_resource_reservations_version_check" CHECK("work_together_room_resource_reservations"."repository_binding_version" > 0),
	CONSTRAINT "wt_room_resource_reservations_template_check" CHECK("work_together_room_resource_reservations"."environment_template" = 'managed-worktree')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_workspace_task_idx` ON `work_together_room_resource_reservations` (`workspace_id`,`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_project_idx` ON `work_together_room_resource_reservations` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_project_source_idx` ON `work_together_room_resource_reservations` (`project_source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_environment_idx` ON `work_together_room_resource_reservations` (`environment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_primary_thread_idx` ON `work_together_room_resource_reservations` (`primary_thread_id`);