CREATE INDEX IF NOT EXISTS `events_tool_call_parent_lookup_idx` ON `events` (`thread_id`,`item_id`,`sequence`) WHERE "events"."item_kind" = 'toolCall';
