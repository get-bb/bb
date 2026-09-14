CREATE TABLE `claimed_thread_spawns` (
	`claim_id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`authority_id` text NOT NULL,
	`authority_host_id` text NOT NULL,
	`authority_method` text NOT NULL,
	`request_sha256` text NOT NULL,
	`request_canonical_json` text NOT NULL,
	`state` text NOT NULL,
	`authorization_id` text,
	`thread_json` text,
	`failure_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `claimed_thread_spawns_attempt_idx` ON `claimed_thread_spawns` (`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `claimed_thread_spawns_authorization_idx` ON `claimed_thread_spawns` (`authorization_id`);--> statement-breakpoint
ALTER TABLE `environments` ADD `provision_request_id` text;--> statement-breakpoint
ALTER TABLE `environments` ADD `provision_request_sha256` text;--> statement-breakpoint
CREATE UNIQUE INDEX `environments_provision_request_idx` ON `environments` (`provision_request_id`);