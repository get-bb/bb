CREATE TABLE `thread_conversation_outlines` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`projection_key` text NOT NULL,
	`sequence_start` integer NOT NULL,
	`response_key` text,
	`items_json` text NOT NULL,
	`state_json` text NOT NULL,
	`response_tail_json` text,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_conversation_outlines_response_check" CHECK(("thread_conversation_outlines"."response_key" IS NULL) = ("thread_conversation_outlines"."response_tail_json" IS NULL))
);
