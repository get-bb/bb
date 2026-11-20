ALTER TABLE `environments` ADD `held_by` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `create_pending` integer DEFAULT false NOT NULL;