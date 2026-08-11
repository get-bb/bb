CREATE TABLE `rewind_rollout_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `thread_active_branches` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`branch_id` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `thread_branches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `thread_active_branches_branch_idx` ON `thread_active_branches` (`branch_id`);--> statement-breakpoint
CREATE TABLE `thread_branches` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`parent_branch_id` text,
	`cutoff_sequence` integer DEFAULT 0 NOT NULL,
	`provider_id` text NOT NULL,
	`provider_thread_id` text,
	`creation_reason` text NOT NULL,
	`lifecycle` text DEFAULT 'staged' NOT NULL,
	`cleanup_status` text DEFAULT 'not-needed' NOT NULL,
	`cleanup_requested_at` integer,
	`cleanup_completed_at` integer,
	`cleanup_error` text,
	`created_at` integer NOT NULL,
	`activated_at` integer,
	`deactivated_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_branch_id`) REFERENCES `thread_branches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `thread_branches_thread_created_idx` ON `thread_branches` (`thread_id`,`created_at`,`id`);--> statement-breakpoint
CREATE INDEX `thread_branches_parent_idx` ON `thread_branches` (`parent_branch_id`);--> statement-breakpoint
CREATE INDEX `thread_branches_provider_session_idx` ON `thread_branches` (`provider_id`,`provider_thread_id`);--> statement-breakpoint
CREATE INDEX `thread_branches_cleanup_idx` ON `thread_branches` (`cleanup_status`,`cleanup_requested_at`);--> statement-breakpoint
CREATE TABLE `thread_rewind_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`branch_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`provider_thread_id` text NOT NULL,
	`anchor_kind` text NOT NULL,
	`anchor_value` text NOT NULL,
	`turn_id` text NOT NULL,
	`source_sequence` integer NOT NULL,
	`status` text DEFAULT 'eligible' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_rewind_checkpoints_thread_branch_sequence_idx` ON `thread_rewind_checkpoints` (`thread_id`,`branch_id`,`source_sequence`);--> statement-breakpoint
CREATE INDEX `thread_rewind_checkpoints_provider_session_idx` ON `thread_rewind_checkpoints` (`provider_id`,`provider_thread_id`,`anchor_kind`,`anchor_value`);--> statement-breakpoint
CREATE INDEX `thread_rewind_checkpoints_thread_sequence_idx` ON `thread_rewind_checkpoints` (`thread_id`,`source_sequence`);--> statement-breakpoint
CREATE TABLE `thread_source_branches` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`branch_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`branch_id`) REFERENCES `thread_branches`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `thread_source_branches_branch_idx` ON `thread_source_branches` (`branch_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `branch_id` text REFERENCES thread_branches(id);--> statement-breakpoint
CREATE INDEX `events_thread_branch_sequence_idx` ON `events` (`thread_id`,`branch_id`,`sequence`);--> statement-breakpoint
/*
 * Data backfill for existing threads (restart-safe): every pre-rewind thread
 * gets one deterministic active root branch, its historical events and
 * checkpoints are stamped to that branch, and source-derived threads record
 * the branch that was active at their fork point.
 */
INSERT INTO `thread_branches` (
	`id`, `thread_id`, `parent_branch_id`, `cutoff_sequence`, `provider_id`,
	`provider_thread_id`, `creation_reason`, `lifecycle`, `cleanup_status`,
	`created_at`, `activated_at`, `updated_at`
)
SELECT
	'br_root:' || t.`id`,
	t.`id`,
	NULL,
	COALESCE(MAX(e.`sequence`), 0),
	t.`provider_id`,
	(
		SELECT latest.`provider_thread_id`
		FROM `events` latest
		WHERE latest.`thread_id` = t.`id`
			AND latest.`provider_thread_id` IS NOT NULL
		ORDER BY latest.`sequence` DESC
		LIMIT 1
	),
	'migration-root',
	'active',
	'not-needed',
	t.`created_at`,
	t.`created_at`,
	t.`updated_at`
FROM `threads` t
LEFT JOIN `events` e ON e.`thread_id` = t.`id`
GROUP BY t.`id`;
--> statement-breakpoint
INSERT INTO `thread_active_branches` (`thread_id`, `branch_id`, `updated_at`)
SELECT `id`, 'br_root:' || `id`, `updated_at` FROM `threads`;
--> statement-breakpoint
INSERT INTO `thread_source_branches` (`thread_id`, `branch_id`, `updated_at`)
SELECT child.`id`, active.`branch_id`, child.`updated_at`
FROM `threads` child
JOIN `thread_active_branches` active
	ON active.`thread_id` = child.`source_thread_id`
WHERE child.`source_thread_id` IS NOT NULL;
--> statement-breakpoint
UPDATE `events`
SET `branch_id` = 'br_root:' || `thread_id`
WHERE `branch_id` IS NULL;
--> statement-breakpoint
UPDATE `thread_rewind_checkpoints`
SET `branch_id` = 'br_root:' || `thread_id`
WHERE NOT EXISTS (
	SELECT 1 FROM `thread_branches`
	WHERE `thread_branches`.`id` = `thread_rewind_checkpoints`.`branch_id`
		AND `thread_branches`.`thread_id` = `thread_rewind_checkpoints`.`thread_id`
);
