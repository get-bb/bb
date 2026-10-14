CREATE TABLE `oauth_code` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`code_challenge` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `server`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_code_expires_at_idx` ON `oauth_code` (`expires_at`);--> statement-breakpoint
CREATE TABLE `oauth_grant` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text NOT NULL,
	`client_id` text NOT NULL,
	`client_name` text NOT NULL,
	`resource` text NOT NULL,
	`scope` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `server`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_grant_user_id_idx` ON `oauth_grant` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_grant_server_id_idx` ON `oauth_grant` (`server_id`);--> statement-breakpoint
CREATE TABLE `oauth_refresh_token` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`grant_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`rotated_at` integer,
	FOREIGN KEY (`grant_id`) REFERENCES `oauth_grant`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_grant_id_idx` ON `oauth_refresh_token` (`grant_id`);