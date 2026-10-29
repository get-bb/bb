INSERT INTO `plugin_settings` (`plugin_id`, `key`, `value`, `updated_at`)
SELECT 'bb--git', 'showGitChanges', `value`, `updated_at`
  FROM `app_settings_values` WHERE `key` = 'showGitChanges'
UNION ALL
SELECT 'bb--github-pr-status', 'showPullRequest', `value`, `updated_at`
  FROM `app_settings_values` WHERE `key` = 'showGitChanges'
ON CONFLICT (`plugin_id`, `key`) DO NOTHING;
--> statement-breakpoint
DELETE FROM `app_settings_values` WHERE `key` = 'showGitChanges';
