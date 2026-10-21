CREATE TABLE `next_step_dismissals` (
	`kind` text PRIMARY KEY NOT NULL,
	`sources` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `next_step_install_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`last_user_message_at` integer NOT NULL,
	`last_successful_thread_id` text,
	`last_successful_turn_id` text,
	`day2_shown_at` integer
);
--> statement-breakpoint
CREATE TABLE `next_steps` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`turn_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`suggestion` text NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `next_steps_status_idx` ON `next_steps` (`status`);