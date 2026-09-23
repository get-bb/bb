CREATE TABLE `ai_global_usage_day` (
	`day` text PRIMARY KEY NOT NULL,
	`spent_micros` integer DEFAULT 0 NOT NULL,
	`reserved_micros` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ai_request_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`server_id` text,
	`model` text,
	`prompt_tokens` integer,
	`completion_tokens` integer,
	`cost_micros` integer DEFAULT 0 NOT NULL,
	`latency_ms` integer NOT NULL,
	`outcome` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `server`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `ai_request_log_created_at_idx` ON `ai_request_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `ai_request_log_user_created_at_idx` ON `ai_request_log` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ai_usage_day` (
	`user_id` text NOT NULL,
	`day` text NOT NULL,
	`spent_micros` integer DEFAULT 0 NOT NULL,
	`reserved_micros` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `day`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_usage_day_day_idx` ON `ai_usage_day` (`day`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_connect_code` (
	`code` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`server_id` text,
	`purpose` text NOT NULL,
	`device_code_hash` text,
	`client_name` text,
	`polled_at` integer,
	`approved_at` integer,
	`denied_at` integer,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_id`) REFERENCES `server`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_connect_code`("code", "user_id", "server_id", "purpose", "expires_at", "consumed_at", "created_at") SELECT "code", "user_id", "server_id", "purpose", "expires_at", "consumed_at", "created_at" FROM `connect_code`;--> statement-breakpoint
DROP TABLE `connect_code`;--> statement-breakpoint
ALTER TABLE `__new_connect_code` RENAME TO `connect_code`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `connect_code_user_id_idx` ON `connect_code` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `connect_code_device_code_hash_idx` ON `connect_code` (`device_code_hash`);