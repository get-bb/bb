CREATE INDEX IF NOT EXISTS `events_compression_idx` ON `events` (`id`) WHERE typeof("events"."data") = 'text' AND octet_length("events"."data") >= 512;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `prompt_history_entries_compression_idx` ON `prompt_history_entries` (`id`) WHERE typeof("prompt_history_entries"."input") = 'text' AND octet_length("prompt_history_entries"."input") >= 512;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `retained_event_outputs_compression_idx` ON `retained_event_outputs` (`event_id`) WHERE typeof("retained_event_outputs"."value") = 'text' AND octet_length("retained_event_outputs"."value") >= 512;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_search_segments_compression_idx` ON `thread_search_segments` (`id`) WHERE typeof("thread_search_segments"."text") = 'text' AND octet_length("thread_search_segments"."text") >= 512;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `thread_search_segments_after_text_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `thread_search_segments_after_delete`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `thread_search_segments_after_insert`;
--> statement-breakpoint
DROP TABLE IF EXISTS `thread_search_segments_fts`;
--> statement-breakpoint
CREATE VIRTUAL TABLE `thread_search_segments_fts` USING fts5(
  `text`,
  tokenize = 'unicode61',
  prefix = '2 3',
  content = '',
  contentless_delete = 1
);
--> statement-breakpoint
INSERT INTO `thread_search_segments_fts` (`rowid`, `text`)
SELECT `rowid`, bb_text(`text`)
FROM `thread_search_segments`;
--> statement-breakpoint
CREATE TRIGGER `thread_search_segments_after_insert`
AFTER INSERT ON `thread_search_segments`
BEGIN
  INSERT INTO `thread_search_segments_fts` (`rowid`, `text`)
  VALUES (new.`rowid`, bb_text(new.`text`));
END;
--> statement-breakpoint
CREATE TRIGGER `thread_search_segments_after_delete`
AFTER DELETE ON `thread_search_segments`
BEGIN
  DELETE FROM `thread_search_segments_fts`
  WHERE `rowid` = old.`rowid`;
END;
--> statement-breakpoint
CREATE TRIGGER `thread_search_segments_after_text_update`
AFTER UPDATE OF `id`, `text` ON `thread_search_segments`
WHEN old.`id` IS NOT new.`id` OR bb_text(old.`text`) IS NOT bb_text(new.`text`)
BEGIN
  DELETE FROM `thread_search_segments_fts`
  WHERE `rowid` = old.`rowid`;
  INSERT INTO `thread_search_segments_fts` (`rowid`, `text`)
  VALUES (new.`rowid`, bb_text(new.`text`));
END;
