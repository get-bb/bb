INSERT INTO `plugin_kv` (`plugin_id`, `key`, `value`, `updated_at`)
SELECT 'bb--git', 'viewedMarksFromCore',
  json_group_array(json_object(
    'environmentId', `environment_id`,
    'targetKey', `target_key`,
    'path', `path`,
    'revision', `revision`,
    'updatedAt', `updated_at`
  )),
  max(`updated_at`)
  FROM `diff_viewed_files`
  HAVING count(*) > 0;
--> statement-breakpoint
DROP TABLE `diff_viewed_files`;
