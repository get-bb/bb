ALTER TABLE `environments` ADD `retire_requested_at` integer;
--> statement-breakpoint
UPDATE `environments`
SET `retire_requested_at` = `updated_at`
WHERE `status` = 'retiring';
