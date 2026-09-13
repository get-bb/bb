-- Adds a durable required execution binding per host and explicit thread ownership.
-- This prevents native fallback and cross-backend session resume.
-- Apply through BB's normal Drizzle migration runner (0120_powerful_cassandra_nova).
-- Do not run this reference separately against a managed or production database.
-- Verify in a disposable database: hosts.execution_integration starts NULL;
-- an integrated start records thread_execution_owners and survives reopen.
CREATE TABLE `thread_execution_owners` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`host_id` text NOT NULL,
	`integration_id` text,
	`plugin_id` text NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `hosts` ADD `execution_integration` text;