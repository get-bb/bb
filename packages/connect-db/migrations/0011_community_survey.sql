CREATE TABLE `community_gift_code` (
	`code` text PRIMARY KEY NOT NULL,
	`claimed` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `community_survey_email` (
	`email_hash` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `community_survey_response` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`answers` text NOT NULL
);
