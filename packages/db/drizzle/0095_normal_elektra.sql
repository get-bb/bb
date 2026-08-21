CREATE TABLE `plugin_marketplace_icons` (
	`marketplace_name` text NOT NULL,
	`entry_id` text NOT NULL,
	`source_url` text NOT NULL,
	`content_type` text NOT NULL,
	`etag` text,
	`content_hash` text NOT NULL,
	`bytes` blob NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`marketplace_name`, `entry_id`)
);
--> statement-breakpoint
CREATE TABLE `plugin_marketplaces` (
	`name` text PRIMARY KEY NOT NULL,
	`manifest_url` text NOT NULL,
	`manifest_json` text NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_successful_refresh_at` integer,
	`last_attempted_refresh_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `plugins` ADD `catalog_marketplace_name` text;--> statement-breakpoint
UPDATE `plugins`
SET `catalog_marketplace_name` = 'bb-official'
WHERE `provenance` = 'catalog';
