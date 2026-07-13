CREATE TABLE `label_claim` (
	`label` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`user_id` text NOT NULL,
	`generation` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `label_claim_user_id_idx` ON `label_claim` (`user_id`);
--> statement-breakpoint
INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
SELECT `handle`, 'handle', `user_id`, `user_id`, lower(hex(randomblob(16))), `created_at`
FROM `profile`;
--> statement-breakpoint
INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
SELECT s.`subdomain`, 'server', s.`id`, s.`user_id`, 'legacy', s.`created_at`
FROM `server` s
WHERE NOT EXISTS (
	SELECT 1
	FROM `profile` p
	WHERE p.`user_id` = s.`user_id`
		AND p.`handle` = s.`subdomain`
);
--> statement-breakpoint
ALTER TABLE `machine` ADD `subdomain` text;
--> statement-breakpoint
CREATE UNIQUE INDEX `machine_subdomain_unique` ON `machine` (`subdomain`);
