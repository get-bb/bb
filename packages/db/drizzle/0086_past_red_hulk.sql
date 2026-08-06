CREATE TABLE `principal_assertion_replays` (
	`jti` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `principal_assertion_replays_expires_at_idx` ON `principal_assertion_replays` (`expires_at`);