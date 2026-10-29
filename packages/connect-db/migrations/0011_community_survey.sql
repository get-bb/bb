CREATE TABLE `community_sticker_code` (
	`slot` integer PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`shipped` integer DEFAULT false NOT NULL,
	CONSTRAINT "community_sticker_pool_cap" CHECK("community_sticker_code"."slot" BETWEEN 1 AND 250)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `community_sticker_code_code_hash_unique` ON `community_sticker_code` (`code_hash`);--> statement-breakpoint
CREATE TABLE `community_survey_email` (
	`email_hash` text PRIMARY KEY NOT NULL
);
--> statement-breakpoint
CREATE TABLE `community_survey_response` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL,
	`answers` text NOT NULL
);
