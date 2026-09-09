CREATE TABLE `thread_timeline_history_revisions` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TRIGGER timeline_history_event_updated AFTER UPDATE ON events
WHEN EXISTS (SELECT 1 FROM threads WHERE id = OLD.thread_id)
BEGIN
  INSERT INTO thread_timeline_history_revisions (thread_id, revision)
  VALUES (OLD.thread_id, 1)
  ON CONFLICT(thread_id) DO UPDATE SET revision = revision + 1;
  INSERT INTO thread_timeline_history_revisions (thread_id, revision)
  SELECT NEW.thread_id, 1 WHERE NEW.thread_id != OLD.thread_id
  ON CONFLICT(thread_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER timeline_history_event_deleted AFTER DELETE ON events
WHEN EXISTS (SELECT 1 FROM threads WHERE id = OLD.thread_id)
BEGIN
  INSERT INTO thread_timeline_history_revisions (thread_id, revision)
  VALUES (OLD.thread_id, 1)
  ON CONFLICT(thread_id) DO UPDATE SET revision = revision + 1;
END;
--> statement-breakpoint
CREATE TRIGGER timeline_history_event_inserted AFTER INSERT ON events
WHEN EXISTS (SELECT 1 FROM events WHERE thread_id = NEW.thread_id AND sequence > NEW.sequence)
BEGIN
  INSERT INTO thread_timeline_history_revisions (thread_id, revision)
  VALUES (NEW.thread_id, 1)
  ON CONFLICT(thread_id) DO UPDATE SET revision = revision + 1;
END;
