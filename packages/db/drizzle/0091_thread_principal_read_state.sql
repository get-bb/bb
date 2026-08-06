CREATE TABLE `thread_principal_read_state` (
	`thread_id` text NOT NULL,
	`principal_id` text NOT NULL,
	`last_read_at` integer,
	`read_cursor` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`thread_id`, `principal_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `thread_principal_read_state_principal_updated_idx` ON `thread_principal_read_state` (`principal_id`,`updated_at`);
--> statement-breakpoint
-- Stock local-owner compatibility: seed one row per existing thread from the
-- global last_read_at authority. Signed principals are intentionally omitted.
INSERT INTO `thread_principal_read_state` (`thread_id`, `principal_id`, `last_read_at`, `read_cursor`, `updated_at`)
SELECT `id`, 'local-owner', `last_read_at`, NULL, `updated_at`
FROM `threads`;
