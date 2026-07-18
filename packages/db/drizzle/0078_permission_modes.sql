UPDATE `project_execution_defaults`
SET `permission_mode` = 'accept-edits'
WHERE `permission_mode` IN ('workspace-write', 'readonly');
--> statement-breakpoint
UPDATE `queued_thread_messages`
SET `permission_mode` = 'accept-edits'
WHERE `permission_mode` = 'workspace-write';
--> statement-breakpoint
UPDATE `queued_thread_messages` AS `queued_message`
SET `permission_mode` = COALESCE(
  (
    SELECT CASE json_extract(`source_event`.`data`, '$.execution.permissionMode')
      WHEN 'workspace-write' THEN 'accept-edits'
      WHEN 'accept-edits' THEN 'accept-edits'
      WHEN 'auto' THEN 'auto'
      WHEN 'full' THEN 'full'
    END
    FROM `threads` AS `side_chat`
    INNER JOIN `threads` AS `source_thread`
      ON `source_thread`.`id` = `side_chat`.`source_thread_id`
    INNER JOIN `events` AS `source_event`
      ON `source_event`.`thread_id` = `source_thread`.`id`
    WHERE `side_chat`.`id` = `queued_message`.`thread_id`
      AND COALESCE(`side_chat`.`origin_kind`, `side_chat`.`child_origin`) = 'side-chat'
      AND `source_event`.`type` IN (
        'client/turn/requested',
        'client/thread/start',
        'client/turn/start'
      )
      AND json_valid(`source_event`.`data`)
      AND json_extract(`source_event`.`data`, '$.execution.permissionMode') IN (
        'workspace-write',
        'accept-edits',
        'auto',
        'full'
      )
    ORDER BY `source_event`.`sequence` DESC
    LIMIT 1
  ),
  (
    SELECT `source_defaults`.`permission_mode`
    FROM `threads` AS `side_chat`
    INNER JOIN `threads` AS `source_thread`
      ON `source_thread`.`id` = `side_chat`.`source_thread_id`
    INNER JOIN `project_execution_defaults` AS `source_defaults`
      ON `source_defaults`.`project_id` = `source_thread`.`project_id`
      AND `source_defaults`.`provider_id` = `source_thread`.`provider_id`
    WHERE `side_chat`.`id` = `queued_message`.`thread_id`
      AND COALESCE(`side_chat`.`origin_kind`, `side_chat`.`child_origin`) = 'side-chat'
  ),
  'accept-edits'
)
WHERE `permission_mode` = 'readonly';
