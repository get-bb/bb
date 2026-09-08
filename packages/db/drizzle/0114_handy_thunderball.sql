ALTER TABLE `environment_launches` ADD `provider_plugin_id` text;--> statement-breakpoint
ALTER TABLE `environment_launches` ADD `path_rejected` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `environment_launches_active_claim_idx` ON `environment_launches` (`host_id`,`claim_path`) WHERE "environment_launches"."environment_id" is null and "environment_launches"."claim_path" is not null;--> statement-breakpoint
ALTER TABLE `environments` ADD `environment_provider_plugin_id` text;
--> statement-breakpoint
UPDATE environments SET environment_provider_plugin_id = CASE environment_provider_id
  WHEN 'project-checkout' THEN 'environment-project-checkout'
  WHEN 'git-worktree' THEN 'environment-git-worktree'
  WHEN 'personal-workspace' THEN 'environment-personal-workspace'
END;
--> statement-breakpoint
UPDATE environment_launches SET provider_plugin_id = CASE provider_id
  WHEN 'project-checkout' THEN 'environment-project-checkout'
  WHEN 'git-worktree' THEN 'environment-git-worktree'
  WHEN 'personal-workspace' THEN 'environment-personal-workspace'
END WHERE attempt > 0;
