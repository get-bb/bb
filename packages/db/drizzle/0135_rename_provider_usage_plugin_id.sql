UPDATE `plugins`
SET `id` = 'bb--provider-usage'
WHERE `id` = 'provider-usage'
  AND `source_kind` = 'builtin'
  AND `source_builtin_name` = 'provider-usage'
  AND NOT EXISTS (SELECT 1 FROM `plugins` WHERE `id` = 'bb--provider-usage');
--> statement-breakpoint
UPDATE `ui_preferences`
SET `value_json` = replace(`value_json`, '"plugin:provider-usage/', '"plugin:bb--provider-usage/'),
    `revision` = `revision` + 1,
    `updated_at` = CAST(unixepoch('subsec') * 1000 AS INTEGER)
WHERE `key` IN ('sidebar.footerOrder', 'sidebar.hiddenFooterItems')
  AND instr(`value_json`, '"plugin:provider-usage/') > 0;
