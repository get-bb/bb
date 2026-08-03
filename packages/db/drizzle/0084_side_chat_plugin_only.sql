ALTER TABLE `system_experiments` DROP COLUMN `side_chat_plugin`;--> statement-breakpoint
-- The builtin side-chat plugin owns every side chat, so the native
-- `origin_kind = 'side-chat'` rows become the plugin's hidden forks. Migration
-- 0038 already moved `child_origin`/`parent_thread_id` onto
-- `origin_kind`/`source_thread_id`, and 0079 hid every side chat, so the only
-- fields left to move are the origin kind and its owning plugin.
UPDATE `threads`
SET `origin_kind` = 'fork',
    `origin_plugin_id` = 'side-chat',
    `visibility` = 'hidden'
WHERE `origin_kind` = 'side-chat'
  AND `source_thread_id` IS NOT NULL;--> statement-breakpoint
-- A side chat without a source thread cannot be reopened as a fork (the panel
-- needs both ids), and `side-chat` is no longer a valid origin kind. Drop the
-- origin rather than strand an unreadable value; the thread itself is kept.
UPDATE `threads`
SET `origin_kind` = NULL
WHERE `origin_kind` = 'side-chat';--> statement-breakpoint
-- Pre-0038 rows are already backfilled, but clear the deprecated column too so
-- no row carries the removed value.
UPDATE `threads`
SET `child_origin` = NULL
WHERE `child_origin` = 'side-chat';
