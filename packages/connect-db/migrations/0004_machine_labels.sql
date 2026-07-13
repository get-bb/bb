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
SELECT s.`subdomain`, 'server', s.`id`, s.`user_id`, lower(hex(randomblob(16))), s.`created_at`
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
--> statement-breakpoint
CREATE TRIGGER `profile_label_claim_insert`
AFTER INSERT ON `profile`
BEGIN
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	VALUES (NEW.`handle`, 'handle', NEW.`user_id`, NEW.`user_id`, lower(hex(randomblob(16))), NEW.`created_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `profile_label_claim_delete`
AFTER DELETE ON `profile`
BEGIN
	DELETE FROM `label_claim`
	WHERE `label` = OLD.`handle` AND `kind` = 'handle' AND `owner_id` = OLD.`user_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `server_label_claim_insert`
AFTER INSERT ON `server`
WHEN NOT EXISTS (
	SELECT 1 FROM `label_claim`
	WHERE `label` = NEW.`subdomain`
		AND `kind` = 'handle'
		AND `owner_id` = NEW.`user_id`
)
BEGIN
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	VALUES (NEW.`subdomain`, 'server', NEW.`id`, NEW.`user_id`, lower(hex(randomblob(16))), NEW.`created_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `server_label_claim_delete`
AFTER DELETE ON `server`
BEGIN
	DELETE FROM `label_claim`
	WHERE `label` = OLD.`subdomain` AND `kind` = 'server' AND `owner_id` = OLD.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `machine_label_claim_insert`
AFTER INSERT ON `machine`
WHEN NEW.`subdomain` IS NOT NULL
BEGIN
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	VALUES (NEW.`subdomain`, 'machine', NEW.`id`, NEW.`user_id`, lower(hex(randomblob(16))), NEW.`created_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `machine_label_claim_update`
AFTER UPDATE OF `subdomain` ON `machine`
WHEN OLD.`subdomain` IS NOT NEW.`subdomain`
BEGIN
	DELETE FROM `label_claim`
	WHERE `label` = OLD.`subdomain` AND `kind` = 'machine' AND `owner_id` = OLD.`id`;
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	SELECT NEW.`subdomain`, 'machine', NEW.`id`, NEW.`user_id`, lower(hex(randomblob(16))), NEW.`created_at`
	WHERE NEW.`subdomain` IS NOT NULL;
END;
--> statement-breakpoint
CREATE TRIGGER `machine_label_claim_delete`
AFTER DELETE ON `machine`
WHEN OLD.`subdomain` IS NOT NULL
BEGIN
	DELETE FROM `label_claim`
	WHERE `label` = OLD.`subdomain` AND `kind` = 'machine' AND `owner_id` = OLD.`id`;
END;
