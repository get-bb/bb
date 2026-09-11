CREATE TABLE `draft_submission_receipts` (
	`draft_id` text NOT NULL,
	`revision` integer NOT NULL,
	`thread_id` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`draft_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`payload_json` text,
	`creation_fingerprint` text NOT NULL,
	`search_text` text NOT NULL,
	`has_input` integer NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer,
	`submitted_at` integer
);
--> statement-breakpoint
CREATE INDEX `drafts_live_updated_idx` ON `drafts` (`updated_at`,`id`) WHERE "drafts"."deleted_at" IS NULL AND "drafts"."submitted_at" IS NULL;--> statement-breakpoint
CREATE INDEX `drafts_live_project_updated_idx` ON `drafts` (`project_id`,`updated_at`,`id`) WHERE "drafts"."deleted_at" IS NULL AND "drafts"."submitted_at" IS NULL;