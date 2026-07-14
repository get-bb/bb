-- Custom SQL migration: Drizzle schema snapshots do not model SQLite triggers.
-- First reconcile source rows written by a claim-ignorant worker after 0004,
-- then install the triggers. D1 applies this migration as one transaction.

-- Fail rather than choose a winner if the source tables already disagree.
CREATE TABLE `_label_claim_reconcile_guard` (
	`ok` integer NOT NULL,
	CONSTRAINT `label_claim_reconciliation_conflict` CHECK (`ok` = 1)
);
--> statement-breakpoint
INSERT INTO `_label_claim_reconcile_guard` (`ok`)
SELECT 0
WHERE EXISTS (
	SELECT 1
	FROM `profile` p
	INNER JOIN `server` s ON s.`subdomain` = p.`handle`
	WHERE s.`user_id` <> p.`user_id`
	UNION ALL
	SELECT 1
	FROM `profile` p
	INNER JOIN `machine` m ON m.`subdomain` = p.`handle`
	UNION ALL
	SELECT 1
	FROM `server` s
	INNER JOIN `machine` m ON m.`subdomain` = s.`subdomain`
);
--> statement-breakpoint
INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
SELECT p.`handle`, 'handle', p.`user_id`, p.`user_id`, lower(hex(randomblob(16))), p.`created_at`
FROM `profile` p
WHERE NOT EXISTS (
	SELECT 1 FROM `label_claim` c WHERE c.`label` = p.`handle`
);
--> statement-breakpoint
INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
SELECT s.`subdomain`, 'server', s.`id`, s.`user_id`, lower(hex(randomblob(16))), s.`created_at`
FROM `server` s
WHERE NOT EXISTS (
	SELECT 1 FROM `profile` p
	WHERE p.`user_id` = s.`user_id` AND p.`handle` = s.`subdomain`
)
AND NOT EXISTS (
	SELECT 1 FROM `label_claim` c WHERE c.`label` = s.`subdomain`
);
--> statement-breakpoint
INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
SELECT m.`subdomain`, 'machine', m.`id`, m.`user_id`, lower(hex(randomblob(16))), m.`created_at`
FROM `machine` m
WHERE m.`subdomain` IS NOT NULL
AND NOT EXISTS (
	SELECT 1 FROM `label_claim` c WHERE c.`label` = m.`subdomain`
);
--> statement-breakpoint
DROP TABLE `_label_claim_reconcile_guard`;
--> statement-breakpoint

-- Every later label-bearing source mutation reserves/releases label_claim in
-- the same SQLite statement, including writes from old web workers.
CREATE TRIGGER `profile_label_claim_insert`
AFTER INSERT ON `profile`
BEGIN
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	VALUES (NEW.`handle`, 'handle', NEW.`user_id`, NEW.`user_id`, lower(hex(randomblob(16))), NEW.`created_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `profile_label_claim_update`
AFTER UPDATE OF `handle` ON `profile`
WHEN OLD.`handle` IS NOT NEW.`handle`
BEGIN
	DELETE FROM `label_claim`
	WHERE `label` = OLD.`handle` AND `kind` = 'handle' AND `owner_id` = OLD.`user_id`;
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	SELECT OLD.`handle`, 'server', s.`id`, s.`user_id`, lower(hex(randomblob(16))), s.`created_at`
	FROM `server` s
	WHERE s.`user_id` = OLD.`user_id` AND s.`subdomain` = OLD.`handle`;
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	VALUES (NEW.`handle`, 'handle', NEW.`user_id`, NEW.`user_id`, lower(hex(randomblob(16))), NEW.`created_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `profile_label_claim_delete`
AFTER DELETE ON `profile`
BEGIN
	DELETE FROM `label_claim`
	WHERE `label` = OLD.`handle` AND `kind` = 'handle' AND `owner_id` = OLD.`user_id`;
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	SELECT OLD.`handle`, 'server', s.`id`, s.`user_id`, lower(hex(randomblob(16))), s.`created_at`
	FROM `server` s
	WHERE s.`user_id` = OLD.`user_id` AND s.`subdomain` = OLD.`handle`;
END;
--> statement-breakpoint
CREATE TRIGGER `server_label_claim_insert`
AFTER INSERT ON `server`
WHEN NOT EXISTS (
	SELECT 1 FROM `profile`
	WHERE `user_id` = NEW.`user_id` AND `handle` = NEW.`subdomain`
)
BEGIN
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	VALUES (NEW.`subdomain`, 'server', NEW.`id`, NEW.`user_id`, lower(hex(randomblob(16))), NEW.`created_at`);
END;
--> statement-breakpoint
CREATE TRIGGER `server_label_claim_update`
AFTER UPDATE OF `subdomain` ON `server`
WHEN OLD.`subdomain` IS NOT NEW.`subdomain`
BEGIN
	DELETE FROM `label_claim`
	WHERE `label` = OLD.`subdomain` AND `kind` = 'server' AND `owner_id` = OLD.`id`;
	INSERT INTO `label_claim` (`label`, `kind`, `owner_id`, `user_id`, `generation`, `created_at`)
	SELECT NEW.`subdomain`, 'server', NEW.`id`, NEW.`user_id`, lower(hex(randomblob(16))), NEW.`created_at`
	WHERE NOT EXISTS (
		SELECT 1 FROM `profile`
		WHERE `user_id` = NEW.`user_id` AND `handle` = NEW.`subdomain`
	);
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
