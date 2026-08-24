DROP INDEX IF EXISTS `events_tool_call_parent_lookup_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `events_todo_tool_call_thread_tool_sequence_idx`;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_delegating_item_lookup_idx` ON `events` (`thread_id`,`item_id`,`sequence`,`item_kind`) WHERE "events"."item_kind" IN ('toolCall', 'delegation');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `events_plan_steps_thread_sequence_idx` ON `events` (`thread_id`,`sequence`) WHERE ("events"."item_kind" = 'planSteps' AND "events"."type" = 'item/completed') OR "events"."type" = 'turn/plan/updated';--> statement-breakpoint
ALTER TABLE `events` DROP COLUMN `tool_name`;