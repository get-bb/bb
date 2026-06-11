CREATE TABLE `thread_search_segments` (
  `id` text PRIMARY KEY NOT NULL,
  `thread_id` text NOT NULL,
  `source_kind` text NOT NULL,
  `source_key` text NOT NULL,
  `source_seq` integer,
  `text` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL,
  FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `thread_search_segments_source_idx` ON `thread_search_segments` (`thread_id`, `source_kind`, `source_key`);
--> statement-breakpoint
CREATE INDEX `thread_search_segments_thread_idx` ON `thread_search_segments` (`thread_id`);
--> statement-breakpoint
CREATE VIRTUAL TABLE `thread_search_segments_fts` USING fts5(
  `id` UNINDEXED,
  `text`,
  tokenize = 'unicode61'
);
--> statement-breakpoint
INSERT INTO `thread_search_segments` (
  `id`,
  `thread_id`,
  `source_kind`,
  `source_key`,
  `source_seq`,
  `text`,
  `created_at`,
  `updated_at`
)
SELECT
  `threads`.`id` || ':title:title',
  `threads`.`id`,
  'title',
  'title',
  NULL,
  trim(`threads`.`title`),
  `threads`.`created_at`,
  `threads`.`updated_at`
FROM `threads`
WHERE `threads`.`title` IS NOT NULL
  AND trim(`threads`.`title`) <> '';
--> statement-breakpoint
INSERT INTO `thread_search_segments` (
  `id`,
  `thread_id`,
  `source_kind`,
  `source_key`,
  `source_seq`,
  `text`,
  `created_at`,
  `updated_at`
)
SELECT
  `threads`.`id` || ':title_fallback:title_fallback',
  `threads`.`id`,
  'title_fallback',
  'title_fallback',
  NULL,
  trim(`threads`.`title_fallback`),
  `threads`.`created_at`,
  `threads`.`updated_at`
FROM `threads`
WHERE `threads`.`title_fallback` IS NOT NULL
  AND trim(`threads`.`title_fallback`) <> '';
--> statement-breakpoint
INSERT INTO `thread_search_segments` (
  `id`,
  `thread_id`,
  `source_kind`,
  `source_key`,
  `source_seq`,
  `text`,
  `created_at`,
  `updated_at`
)
WITH `visible_user_messages` AS (
  SELECT
    `events`.`thread_id` || ':user_message:event:' || `events`.`sequence` AS `id`,
    `events`.`thread_id` AS `thread_id`,
    'user_message' AS `source_kind`,
    'event:' || `events`.`sequence` AS `source_key`,
    `events`.`sequence` AS `source_seq`,
    trim(
      COALESCE(
        (
          SELECT group_concat(json_extract(`input_part`.`value`, '$.text'), char(10))
          FROM json_each(`events`.`data`, '$.input') AS `input_part`
          WHERE json_extract(`input_part`.`value`, '$.type') = 'text'
            AND COALESCE(json_extract(`input_part`.`value`, '$.visibility'), '') <> 'agent-only'
        ),
        ''
      )
    ) AS `text`,
    `events`.`created_at` AS `created_at`
  FROM `events`
  WHERE `events`.`type` = 'client/turn/requested'
)
SELECT
  `id`,
  `thread_id`,
  `source_kind`,
  `source_key`,
  `source_seq`,
  `text`,
  `created_at`,
  `created_at`
FROM `visible_user_messages`
WHERE `text` <> '';
--> statement-breakpoint
INSERT INTO `thread_search_segments` (
  `id`,
  `thread_id`,
  `source_kind`,
  `source_key`,
  `source_seq`,
  `text`,
  `created_at`,
  `updated_at`
)
SELECT
  `events`.`thread_id` || ':assistant_message:event:' || `events`.`sequence`,
  `events`.`thread_id`,
  'assistant_message',
  'event:' || `events`.`sequence`,
  `events`.`sequence`,
  trim(json_extract(`events`.`data`, '$.item.text')),
  `events`.`created_at`,
  `events`.`created_at`
FROM `events`
WHERE `events`.`type` = 'item/completed'
  AND `events`.`item_kind` = 'agentMessage'
  AND json_extract(`events`.`data`, '$.item.type') = 'agentMessage'
  AND trim(COALESCE(json_extract(`events`.`data`, '$.item.text'), '')) <> '';
--> statement-breakpoint
INSERT INTO `thread_search_segments` (
  `id`,
  `thread_id`,
  `source_kind`,
  `source_key`,
  `source_seq`,
  `text`,
  `created_at`,
  `updated_at`
)
SELECT
  `events`.`thread_id` || ':system_message:event:' || `events`.`sequence`,
  `events`.`thread_id`,
  'system_message',
  'event:' || `events`.`sequence`,
  `events`.`sequence`,
  trim(json_extract(`events`.`data`, '$.text')),
  `events`.`created_at`,
  `events`.`created_at`
FROM `events`
WHERE `events`.`type` = 'system/manager/user_message'
  AND trim(COALESCE(json_extract(`events`.`data`, '$.text'), '')) <> '';
--> statement-breakpoint
INSERT INTO `thread_search_segments_fts` (`id`, `text`)
SELECT `id`, `text`
FROM `thread_search_segments`;
--> statement-breakpoint
CREATE TRIGGER `thread_search_segments_after_insert`
AFTER INSERT ON `thread_search_segments`
BEGIN
  INSERT INTO `thread_search_segments_fts` (`id`, `text`)
  VALUES (new.`id`, new.`text`);
END;
--> statement-breakpoint
CREATE TRIGGER `thread_search_segments_after_delete`
AFTER DELETE ON `thread_search_segments`
BEGIN
  DELETE FROM `thread_search_segments_fts`
  WHERE `id` = old.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `thread_search_segments_after_text_update`
AFTER UPDATE OF `id`, `text` ON `thread_search_segments`
BEGIN
  DELETE FROM `thread_search_segments_fts`
  WHERE `id` = old.`id`;

  INSERT INTO `thread_search_segments_fts` (`id`, `text`)
  VALUES (new.`id`, new.`text`);
END;
