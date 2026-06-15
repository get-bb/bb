UPDATE `environments`
SET `status` = 'retiring'
WHERE `status` = 'ready'
  AND `cleanup_requested_at` IS NOT NULL;--> statement-breakpoint
UPDATE `threads`
SET `status` = 'starting'
WHERE `status` IN ('created', 'provisioning');--> statement-breakpoint
DROP INDEX `environments_cleanup_requested_idx`;--> statement-breakpoint
ALTER TABLE `environments` DROP COLUMN `cleanup_requested_at`;
