PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_terminal_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text,
	`environment_id` text,
	`host_id` text NOT NULL,
	`daemon_session_id` text,
	`title` text NOT NULL,
	`initial_cwd` text NOT NULL,
	`cols` integer NOT NULL,
	`rows` integer NOT NULL,
	`status` text NOT NULL,
	`exit_code` integer,
	`close_reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`last_user_input_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`environment_id`) REFERENCES `environments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`daemon_session_id`) REFERENCES `host_daemon_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_terminal_sessions`("id", "thread_id", "environment_id", "host_id", "daemon_session_id", "title", "initial_cwd", "cols", "rows", "status", "exit_code", "close_reason", "created_at", "updated_at", "last_user_input_at") SELECT "id", "thread_id", "environment_id", "host_id", "daemon_session_id", "title", "initial_cwd", "cols", "rows", "status", "exit_code", "close_reason", "created_at", "updated_at", "last_user_input_at" FROM `terminal_sessions`;--> statement-breakpoint
DROP TABLE `terminal_sessions`;--> statement-breakpoint
ALTER TABLE `__new_terminal_sessions` RENAME TO `terminal_sessions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `terminal_sessions_thread_status_updated_idx` ON `terminal_sessions` (`thread_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_environment_status_idx` ON `terminal_sessions` (`environment_id`,`status`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_host_status_idx` ON `terminal_sessions` (`host_id`,`status`);--> statement-breakpoint
CREATE INDEX `terminal_sessions_daemon_session_idx` ON `terminal_sessions` (`daemon_session_id`);