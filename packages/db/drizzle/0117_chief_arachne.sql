CREATE TABLE `plugin_listing_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`notice_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`consumed_at` integer
);
--> statement-breakpoint
CREATE INDEX `plugin_listing_notices_consumed_idx` ON `plugin_listing_notices` (`consumed_at`);--> statement-breakpoint
CREATE TABLE `plugin_listings` (
	`plugin_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`record_json` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `plugin_listings_status_idx` ON `plugin_listings` (`status`);