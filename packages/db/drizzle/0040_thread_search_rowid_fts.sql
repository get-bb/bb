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
  tokenize = 'unicode61'
);
--> statement-breakpoint
INSERT INTO `thread_search_segments_fts` (`rowid`, `text`)
SELECT `rowid`, `text`
FROM `thread_search_segments`;
--> statement-breakpoint
CREATE TRIGGER `thread_search_segments_after_insert`
AFTER INSERT ON `thread_search_segments`
BEGIN
  INSERT INTO `thread_search_segments_fts` (`rowid`, `text`)
  VALUES (new.`rowid`, new.`text`);
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
BEGIN
  DELETE FROM `thread_search_segments_fts`
  WHERE `rowid` = old.`rowid`;

  INSERT INTO `thread_search_segments_fts` (`rowid`, `text`)
  VALUES (new.`rowid`, new.`text`);
END;
