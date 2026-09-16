ALTER TABLE `threads` ADD `lifecycle_owner_thread_id` text REFERENCES threads(id) ON DELETE RESTRICT;--> statement-breakpoint
CREATE INDEX `threads_lifecycle_owner_idx` ON `threads` (`lifecycle_owner_thread_id`);
--> statement-breakpoint
CREATE TRIGGER threads_lifecycle_owner_insert BEFORE INSERT ON threads
WHEN NEW.lifecycle_owner_thread_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'invalid lifecycle owner') WHERE NEW.id = NEW.lifecycle_owner_thread_id
    OR NOT EXISTS (SELECT 1 FROM threads owner WHERE owner.id = NEW.lifecycle_owner_thread_id
      AND owner.archived_at IS NULL AND owner.deleted_at IS NULL);
END;
--> statement-breakpoint
CREATE TRIGGER threads_lifecycle_owner_immutable BEFORE UPDATE OF lifecycle_owner_thread_id ON threads
WHEN NEW.lifecycle_owner_thread_id IS NOT OLD.lifecycle_owner_thread_id
BEGIN
  SELECT RAISE(ABORT, 'lifecycle ownership is immutable');
END;
