PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_work_together_room_resource_reservations` (
	`binding_id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`task_id` text NOT NULL,
	`cell_id` text NOT NULL,
	`work_kind` text NOT NULL,
	`repository_snapshot_id` text,
	`repository_binding_id` text,
	`repository_binding_version` integer,
	`provider_repository_id` text,
	`object_format` text,
	`base_revision` text,
	`base_branch` text,
	`generated_branch` text,
	`candidate_host_id` text NOT NULL,
	`bb_host_id` text,
	`project_name` text,
	`provider_id` text,
	`source_path` text,
	`environment_template` text NOT NULL,
	`project_id` text NOT NULL,
	`project_source_id` text NOT NULL,
	`environment_id` text NOT NULL,
	`primary_thread_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "wt_room_resource_reservations_version_check" CHECK("__new_work_together_room_resource_reservations"."repository_binding_version" IS NULL OR "__new_work_together_room_resource_reservations"."repository_binding_version" > 0),
	CONSTRAINT "wt_room_resource_reservations_template_check" CHECK("__new_work_together_room_resource_reservations"."environment_template" IN ('isolated-scratch', 'detached-read-only', 'managed-worktree'))
);
--> statement-breakpoint
INSERT INTO `__new_work_together_room_resource_reservations` (
	"binding_id", "workspace_id", "task_id", "cell_id", "work_kind",
	"repository_snapshot_id", "repository_binding_id", "repository_binding_version",
	"provider_repository_id", "object_format", "base_revision", "base_branch",
	"generated_branch", "candidate_host_id", "bb_host_id", "project_name",
	"provider_id", "source_path", "environment_template", "project_id",
	"project_source_id", "environment_id", "primary_thread_id", "created_at", "updated_at"
)
SELECT
	"binding_id", "workspace_id", "task_id", "cell_id", 'code',
	NULL, "repository_binding_id", "repository_binding_version",
	"provider_repository_id", NULL, "base_revision", "base_branch",
	"generated_branch", "candidate_host_id", "bb_host_id", "project_name",
	"provider_id", "source_path", "environment_template", "project_id",
	"project_source_id", "environment_id", "primary_thread_id", "created_at", "updated_at"
FROM `work_together_room_resource_reservations`;--> statement-breakpoint
DROP TABLE `work_together_room_resource_reservations`;--> statement-breakpoint
ALTER TABLE `__new_work_together_room_resource_reservations` RENAME TO `work_together_room_resource_reservations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_workspace_task_idx` ON `work_together_room_resource_reservations` (`workspace_id`,`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_project_idx` ON `work_together_room_resource_reservations` (`project_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_project_source_idx` ON `work_together_room_resource_reservations` (`project_source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_environment_idx` ON `work_together_room_resource_reservations` (`environment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `wt_room_resource_reservations_primary_thread_idx` ON `work_together_room_resource_reservations` (`primary_thread_id`);
