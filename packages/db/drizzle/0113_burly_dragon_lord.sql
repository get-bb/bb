CREATE INDEX IF NOT EXISTS `events_span_idx` ON `events` (`thread_id`,`turn_id`,`item_id`);
