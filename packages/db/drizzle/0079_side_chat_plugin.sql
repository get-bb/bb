ALTER TABLE `system_experiments` ADD `side_chat_plugin` integer DEFAULT false NOT NULL;--> statement-breakpoint
UPDATE `threads`
SET `visibility` = 'hidden'
WHERE `origin_kind` = 'side-chat'
   OR `child_origin` = 'side-chat';
