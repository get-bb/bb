DROP INDEX IF EXISTS `events_goal_thread_sequence_idx`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_thread_state_thread_sequence_idx` ON `events` (`thread_id`,`sequence`) WHERE "events"."type" IN ('thread/goal/updated', 'thread/goal/cleared', 'thread/extensionState/updated');
