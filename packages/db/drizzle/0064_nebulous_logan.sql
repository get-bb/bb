ALTER TABLE `hosts` ADD `last_rejected_protocol_version` integer;--> statement-breakpoint
ALTER TABLE `projects` ADD `git_remote_url` text;--> statement-breakpoint
ALTER TABLE `system_experiments` ADD `multi_machine` integer DEFAULT false NOT NULL;