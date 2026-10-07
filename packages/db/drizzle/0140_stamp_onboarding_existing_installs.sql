INSERT INTO `app_settings_values` (`key`, `value`, `updated_at`)
SELECT 'onboardingCompletedAt', '"' || strftime('%Y-%m-%dT%H:%M:%fZ', 'now') || '"', CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (
    SELECT 1 FROM `app_settings_values` WHERE `key` = 'onboardingCompletedAt'
  )
  AND (
    EXISTS (SELECT 1 FROM `projects` WHERE `kind` != 'personal')
    OR EXISTS (SELECT 1 FROM `threads`)
  );
--> statement-breakpoint
UPDATE `app_settings_values`
SET `value` = '"' || strftime('%Y-%m-%dT%H:%M:%fZ', 'now') || '"',
    `updated_at` = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE `key` = 'onboardingCompletedAt'
  AND `value` = 'null'
  AND (
    EXISTS (SELECT 1 FROM `projects` WHERE `kind` != 'personal')
    OR EXISTS (SELECT 1 FROM `threads`)
  );
