INSERT OR IGNORE INTO `plugin_kv` (`plugin_id`, `key`, `value`, `updated_at`)
SELECT 'bb--git', 'viewed/' || json_array(`environment_id`, `target_key`, `path`), json_quote(`revision`), `updated_at`
FROM `diff_viewed_files`;
--> statement-breakpoint
DROP TABLE `diff_viewed_files`;
--> statement-breakpoint
INSERT OR IGNORE INTO `plugin_kv` (`plugin_id`, `key`, `value`, `updated_at`)
SELECT 'core', 'migrated-plugin-enabled/bb--git', 'false', `updated_at`
FROM `app_settings_values` WHERE `key` = 'showGitChanges' AND `value` = 'false';
--> statement-breakpoint
DELETE FROM `app_settings_values` WHERE `key` = 'showGitChanges';
--> statement-breakpoint
UPDATE `thread_tabs` SET `tabs_json` = (
  SELECT json_group_array(json(`tab`)) FROM (
    SELECT CASE WHEN json_extract(`value`, '$.kind') = 'git-diff'
      THEN json_object('id', 'plugin-fixed:bb--git:diff', 'kind', 'plugin-fixed', 'pluginId', 'bb--git', 'tabId', 'diff')
      ELSE `value` END AS `tab`
    FROM json_each(`thread_tabs`.`tabs_json`)
    WHERE json_extract(`value`, '$.kind') <> 'git-diff' OR NOT EXISTS (
      SELECT 1 FROM json_each(`thread_tabs`.`tabs_json`) AS `existing`
      WHERE json_extract(`existing`.`value`, '$.kind') = 'plugin-fixed'
        AND json_extract(`existing`.`value`, '$.pluginId') = 'bb--git'
        AND json_extract(`existing`.`value`, '$.tabId') = 'diff'
    )
    ORDER BY CAST(`key` AS INTEGER)
  )
), `revision` = `revision` + 1
WHERE EXISTS (SELECT 1 FROM json_each(`tabs_json`) WHERE json_extract(`value`, '$.kind') = 'git-diff');
--> statement-breakpoint
UPDATE `app_settings_values` SET `value` = (
  SELECT json_group_array(json(`binding`)) FROM (
    SELECT CASE WHEN json_extract(`current`.`value`, '$.command') = 'diff.toggle'
      THEN json_set(`current`.`value`, '$.command', 'plugin:bb--git/toggle-diff') ELSE `current`.`value` END AS `binding`
    FROM json_each(`app_settings_values`.`value`) AS `current`
    WHERE json_extract(`current`.`value`, '$.command') <> 'diff.toggle' OR NOT EXISTS (
      SELECT 1 FROM json_each(`app_settings_values`.`value`) AS `existing`
      WHERE json_extract(`existing`.`value`, '$.command') = 'plugin:bb--git/toggle-diff'
        AND COALESCE(json_extract(`existing`.`value`, '$.platform'), '') = COALESCE(json_extract(`current`.`value`, '$.platform'), '')
    ) ORDER BY CAST(`current`.`key` AS INTEGER)
  )
) WHERE `key` = 'keybindingOverrides' AND json_valid(`value`);
