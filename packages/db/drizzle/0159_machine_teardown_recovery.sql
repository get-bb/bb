ALTER TABLE `hosts` ADD `teardown_blocked_by_environment_id` text;--> statement-breakpoint
ALTER TABLE `hosts` DROP COLUMN `suspend_retry_at`;