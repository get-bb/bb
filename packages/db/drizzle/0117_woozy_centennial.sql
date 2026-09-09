ALTER TABLE `machine_lifecycles` DROP COLUMN `observed_state`;--> statement-breakpoint
ALTER TABLE `machine_lifecycles` DROP COLUMN `observed_at`;--> statement-breakpoint
ALTER TABLE `machine_lifecycles` DROP COLUMN `expires_at`;--> statement-breakpoint
ALTER TABLE `machine_lifecycles` DROP COLUMN `maintenance_at`;--> statement-breakpoint
ALTER TABLE `machine_lifecycles` DROP COLUMN `last_snapshot_at`;--> statement-breakpoint
ALTER TABLE `machine_lifecycles` DROP COLUMN `idle_suspend_ms`;--> statement-breakpoint
ALTER TABLE `machine_lifecycles` DROP COLUMN `deadline_lead_ms`;--> statement-breakpoint
ALTER TABLE `machine_lifecycles` DROP COLUMN `unused_since`;
--> statement-breakpoint
UPDATE `machine_lifecycles` SET `recovery_state` = 'recoverable' WHERE `recovery_state` = 'lost-since-last-snapshot';
