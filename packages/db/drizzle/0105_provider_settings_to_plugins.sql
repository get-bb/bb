-- The five provider knobs (Codex/Claude memory, native subagents, Claude's
-- Workflow tool) moved from the shared app settings into the owning provider
-- plugin's own settings (`bb.settings.define` in provider-codex and
-- provider-claude-code). Carry each stored value across so a user who turned
-- one off keeps it off, then retire the shared rows. Both tables store JSON
-- text, so the values copy verbatim; an existing plugin row wins.
INSERT INTO `plugin_settings` (`plugin_id`, `key`, `value`, `updated_at`)
SELECT 'provider-codex', 'memoryEnabled', `value`, `updated_at`
  FROM `app_settings_values` WHERE `key` = 'codexMemoryEnabled'
UNION ALL
SELECT 'provider-codex', 'subagentsDisabled', `value`, `updated_at`
  FROM `app_settings_values` WHERE `key` = 'codexSubagentsDisabled'
UNION ALL
SELECT 'provider-claude-code', 'memoryEnabled', `value`, `updated_at`
  FROM `app_settings_values` WHERE `key` = 'claudeCodeMemoryEnabled'
UNION ALL
SELECT 'provider-claude-code', 'subagentsDisabled', `value`, `updated_at`
  FROM `app_settings_values` WHERE `key` = 'claudeCodeSubagentsDisabled'
UNION ALL
SELECT 'provider-claude-code', 'workflowsDisabled', `value`, `updated_at`
  FROM `app_settings_values` WHERE `key` = 'claudeCodeWorkflowsDisabled'
ON CONFLICT (`plugin_id`, `key`) DO NOTHING;
--> statement-breakpoint
DELETE FROM `app_settings_values`
WHERE `key` IN (
  'codexMemoryEnabled',
  'codexSubagentsDisabled',
  'claudeCodeMemoryEnabled',
  'claudeCodeSubagentsDisabled',
  'claudeCodeWorkflowsDisabled'
);
