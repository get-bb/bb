ALTER TABLE `events` ADD `parent_tool_call_id` text;--> statement-breakpoint
UPDATE `events`
SET `parent_tool_call_id` = COALESCE(
  NULLIF(json_extract(`data`, '$.item.parentToolCallId'), ''),
  NULLIF(json_extract(`data`, '$.parentToolCallId'), '')
)
WHERE instr(`data`, '"parentToolCallId"') > 0;--> statement-breakpoint
CREATE INDEX `events_parent_tool_call_thread_parent_sequence_idx` ON `events` (`thread_id`,`parent_tool_call_id`,`sequence`) WHERE "events"."parent_tool_call_id" IS NOT NULL;
