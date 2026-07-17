ALTER TABLE `plugins` RENAME COLUMN "marketplace_entry_id" TO "catalog_entry_id";--> statement-breakpoint
CREATE TABLE `plugin_catalog` (
	`id` integer PRIMARY KEY NOT NULL,
	`catalog_json` text NOT NULL,
	`etag` text,
	`last_modified` text,
	`last_successful_refresh_at` integer,
	`last_attempted_refresh_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "plugin_catalog_singleton" CHECK("plugin_catalog"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `plugin_catalog` (
	`id`,
	`catalog_json`,
	`etag`,
	`last_modified`,
	`last_successful_refresh_at`,
	`last_attempted_refresh_at`,
	`last_error`,
	`created_at`,
	`updated_at`
)
SELECT
	1,
	json_remove(`catalog_json`, '$.name', '$.displayName'),
	NULL,
	NULL,
	`last_successful_refresh_at`,
	`last_attempted_refresh_at`,
	`last_error`,
	`created_at`,
	`updated_at`
FROM `marketplaces`
WHERE
	`id` = 'bb-official'
	AND `source_kind` = 'git'
	AND `location` = 'https://github.com/ymichael/bb.git'
	AND `requested_git_ref` = 'main'
	AND `catalog_json` IS NOT NULL
LIMIT 1;
--> statement-breakpoint
UPDATE `plugins`
SET
	`catalog_entry_id` = CASE
		WHEN
			`provenance` = 'marketplace'
			AND `marketplace_id` = 'bb-official'
			AND EXISTS (
				SELECT 1
				FROM `marketplaces`
				WHERE
					`id` = 'bb-official'
					AND `source_kind` = 'git'
					AND `location` = 'https://github.com/ymichael/bb.git'
					AND `requested_git_ref` = 'main'
			)
			THEN `catalog_entry_id`
		ELSE NULL
	END,
	`provenance` = CASE
		WHEN
			`provenance` = 'marketplace'
			AND `marketplace_id` = 'bb-official'
			AND EXISTS (
				SELECT 1
				FROM `marketplaces`
				WHERE
					`id` = 'bb-official'
					AND `source_kind` = 'git'
					AND `location` = 'https://github.com/ymichael/bb.git'
					AND `requested_git_ref` = 'main'
			)
			THEN 'catalog'
		WHEN `provenance` = 'marketplace'
			THEN 'direct'
		ELSE `provenance`
	END;
--> statement-breakpoint
DROP TABLE `marketplaces`;--> statement-breakpoint
ALTER TABLE `plugins` DROP COLUMN `marketplace_id`;
