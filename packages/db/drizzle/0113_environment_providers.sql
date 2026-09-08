CREATE TABLE `environment_launches` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`provider_plugin_id` text,
	`path_rejected` integer DEFAULT false NOT NULL,
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
CREATE INDEX `environment_launches_phase_idx` ON `environment_launches` (`phase`);--> statement-breakpoint
CREATE INDEX `environment_launches_active_claim_idx` ON `environment_launches` (`host_id`,`claim_path`) WHERE "environment_launches"."environment_id" is null and "environment_launches"."claim_path" is not null;--> statement-breakpoint
ALTER TABLE `environments` ADD `environment_provider_id` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `environment_provider_plugin_id` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `provider_owns_path` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `environments` ADD `environment_provider_selection` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `environment_provider_instance_key` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `retire_at` integer;--> statement-breakpoint
ALTER TABLE `environments` ADD `teardown_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `environments` ADD `teardown_status` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `teardown_message` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `resource` text;--> statement-breakpoint
CREATE INDEX `environments_provider_instance_idx` ON `environments` (`environment_provider_id`,`environment_provider_instance_key`);--> statement-breakpoint
UPDATE `environments`
SET
  `environment_provider_id` = 'git-worktree',
  `environment_provider_selection` = json_object(
    'machine', json_object('type', 'existing', 'hostId', `host_id`),
    'inputs', json_object(
      'branch',
      CASE
        WHEN `base_branch` IS NULL OR `base_branch` = '' THEN json_object('kind', 'default')
        ELSE json_object('kind', 'named', 'name', `base_branch`)
      END
    )
  )
WHERE `workspace_provision_type` = 'managed-worktree';
--> statement-breakpoint
UPDATE `environments`
SET
  `environment_provider_id` = 'personal-workspace',
  `environment_provider_selection` = json_object(
    'machine', json_object('type', 'existing', 'hostId', `host_id`),
    'inputs', json('null')
  )
WHERE `workspace_provision_type` = 'personal';
--> statement-breakpoint
UPDATE `environments`
SET
  `environment_provider_id` = 'project-checkout',
  `environment_provider_selection` = CASE
    WHEN `path` IS NULL THEN json_object(
      'machine', json_object('type', 'existing', 'hostId', `host_id`),
      'inputs', json_object()
    )
    ELSE json_object(
      'machine', json_object('type', 'existing', 'hostId', `host_id`),
      'inputs', json_object('path', `path`)
    )
  END
WHERE `workspace_provision_type` = 'unmanaged';
--> statement-breakpoint
UPDATE `environments`
SET `is_worktree` = 1
WHERE `environment_provider_id` = 'git-worktree';
--> statement-breakpoint
UPDATE `environments`
SET `provider_owns_path` = 1
WHERE `environment_provider_id` IN ('git-worktree', 'personal-workspace');
--> statement-breakpoint
UPDATE `environments`
SET `status` = 'ready'
WHERE `status` = 'retiring';
--> statement-breakpoint
UPDATE `environments`
SET `status` = 'error'
WHERE `status` = 'destroying';
--> statement-breakpoint
UPDATE `threads`
SET `pending_start_context` = json_set(
  json_remove(
    `pending_start_context`,
    '$.environmentIntent.hostId',
    '$.environmentIntent.sourcePath',
    '$.environmentIntent.workspaceProvisionType',
    '$.environmentIntent.baseBranch'
  ),
  '$.environmentIntent.type', 'provider',
  '$.environmentIntent.environmentProviderId', 'git-worktree',
  '$.environmentIntent.machine', json_object(
    'type', 'existing',
    'hostId', json_extract(`pending_start_context`, '$.environmentIntent.hostId')
  ),
  '$.environmentIntent.inputs', json_object(
    'branch', json_extract(`pending_start_context`, '$.environmentIntent.baseBranch')
  )
)
WHERE `pending_start_context` IS NOT NULL
  AND json_valid(`pending_start_context`)
  AND json_extract(`pending_start_context`, '$.environmentIntent.type') = 'direct-managed';
--> statement-breakpoint
UPDATE `threads`
SET `pending_start_context` = json_set(
  json_remove(
    `pending_start_context`,
    '$.environmentIntent.hostId',
    '$.environmentIntent.workspaceProvisionType'
  ),
  '$.environmentIntent.type', 'provider',
  '$.environmentIntent.environmentProviderId', 'personal-workspace',
  '$.environmentIntent.machine', json_object(
    'type', 'existing',
    'hostId', json_extract(`pending_start_context`, '$.environmentIntent.hostId')
  ),
  '$.environmentIntent.inputs', json('null')
)
WHERE `pending_start_context` IS NOT NULL
  AND json_valid(`pending_start_context`)
  AND json_extract(`pending_start_context`, '$.environmentIntent.type') = 'direct-personal';
--> statement-breakpoint
UPDATE `threads`
SET `pending_start_context` = json_set(
  json_remove(
    `pending_start_context`,
    '$.environmentIntent.hostId',
    '$.environmentIntent.path',
    '$.environmentIntent.branch',
    '$.environmentIntent.environmentId',
    '$.environmentIntent.mergeBaseBranch'
  ),
  '$.environmentIntent.type', 'provider',
  '$.environmentIntent.environmentProviderId', 'project-checkout',
  '$.environmentIntent.machine', json_object(
    'type', 'existing',
    'hostId', json_extract(`pending_start_context`, '$.environmentIntent.hostId')
  ),
  '$.environmentIntent.inputs', CASE
    WHEN json_extract(`pending_start_context`, '$.environmentIntent.branch') IS NULL
      THEN json_object('path', json_extract(`pending_start_context`, '$.environmentIntent.path'))
    ELSE json_object(
      'path', json_extract(`pending_start_context`, '$.environmentIntent.path'),
      'branch', json(json_extract(`pending_start_context`, '$.environmentIntent.branch'))
    )
  END
)
WHERE `pending_start_context` IS NOT NULL
  AND json_valid(`pending_start_context`)
  AND json_extract(`pending_start_context`, '$.environmentIntent.type') IN ('direct-unmanaged', 'checkout-unmanaged')
  AND json_extract(`pending_start_context`, '$.environmentIntent.path') IS NOT NULL;
--> statement-breakpoint
UPDATE environments SET environment_provider_plugin_id = CASE environment_provider_id
  WHEN 'project-checkout' THEN 'environment-project-checkout'
  WHEN 'git-worktree' THEN 'environment-git-worktree'
  WHEN 'personal-workspace' THEN 'environment-personal-workspace'
END;
--> statement-breakpoint
ALTER TABLE `environments` DROP COLUMN `managed`;--> statement-breakpoint
ALTER TABLE `environments` DROP COLUMN `destroy_attempt_id`;--> statement-breakpoint
ALTER TABLE `environments` DROP COLUMN `retire_requested_at`;--> statement-breakpoint
ALTER TABLE `environments` DROP COLUMN `workspace_provision_type`;