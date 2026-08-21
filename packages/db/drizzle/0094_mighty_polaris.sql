ALTER TABLE `plugin_artifacts` ADD `git_checkout_root` text;
--> statement-breakpoint
UPDATE `plugin_artifacts`
SET `git_checkout_root` = substr(
  `path`,
  1,
  instr(`path`, '/' || `git_resolved_commit` || '/') + length(`git_resolved_commit`)
)
WHERE `source_kind` = 'git'
  AND `git_checkout_root` IS NULL
  AND `git_resolved_commit` IS NOT NULL
  AND instr(`path`, '/' || `git_resolved_commit` || '/') > 0;
--> statement-breakpoint
UPDATE `plugin_artifacts`
SET `git_checkout_root` = substr(
  `path`,
  1,
  instr(`path`, '\' || `git_resolved_commit` || '\') + length(`git_resolved_commit`)
)
WHERE `source_kind` = 'git'
  AND `git_checkout_root` IS NULL
  AND `git_resolved_commit` IS NOT NULL
  AND instr(`path`, '\' || `git_resolved_commit` || '\') > 0;
--> statement-breakpoint
UPDATE `plugin_artifacts`
SET `git_checkout_root` = `path`
WHERE `source_kind` = 'git'
  AND `git_checkout_root` IS NULL
  AND `git_resolved_commit` IS NOT NULL
  AND (
    `path` LIKE '%/' || `git_resolved_commit`
    OR `path` LIKE '%\' || `git_resolved_commit`
  );
