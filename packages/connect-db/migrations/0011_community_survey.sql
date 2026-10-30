CREATE TABLE `community_sticker_claim` (
	`code` text PRIMARY KEY NOT NULL,
	`submission_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`last_attempt_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_sticker_claim_submission_id_unique` ON `community_sticker_claim` (`submission_id`);--> statement-breakpoint
CREATE TABLE `community_survey_email` (
	`email_hash` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `community_survey_response` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`answers` text NOT NULL,
	`emailed_at` integer
);
