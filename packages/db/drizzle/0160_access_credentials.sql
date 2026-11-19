CREATE TABLE `access_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text NOT NULL,
	`secure_only` integer NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_credentials_token_hash_unique` ON `access_credentials` (`token_hash`);