INSERT INTO `plugin_settings` (`plugin_id`, `key`, `value`, `updated_at`)
SELECT 'keep-awake', 'enabled', 'true', `updated_at`
FROM `app_settings`
WHERE `caffeinate` = 1
ON CONFLICT (`plugin_id`, `key`) DO NOTHING;
--> statement-breakpoint
ALTER TABLE `app_settings` DROP COLUMN `caffeinate`;
