ALTER TABLE `machine_lifecycles` DROP COLUMN `retire_after_ms`;--> statement-breakpoint
ALTER TABLE `machine_lifecycles` DROP COLUMN `retention_at`;--> statement-breakpoint
ALTER TABLE `machine_lifecycles` DROP COLUMN `keep`;
--> statement-breakpoint
UPDATE `hosts` SET `phase` = CASE WHEN `suspended_at` IS NULL THEN 'active' ELSE 'suspended' END, `retire_at` = NULL WHERE `phase` = 'retiring' AND `removal_started_at` IS NULL AND `destroyed_at` IS NULL;
