CREATE TABLE `host_server_access_grants` (
	`host_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`grant_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`host_id`, `provider_id`),
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `host_daemon_sessions` ADD `route_provider_id` text;--> statement-breakpoint
ALTER TABLE `host_daemon_sessions` ADD `route_kind` text;--> statement-breakpoint
INSERT INTO `host_server_access_grants` (`host_id`, `provider_id`, `grant_id`, `created_at`, `updated_at`)
SELECT `id`, `server_access_provider_id`, `server_access_grant_id`, `updated_at`, `updated_at`
FROM `hosts`
WHERE `server_access_provider_id` IS NOT NULL;--> statement-breakpoint
INSERT INTO `app_settings_values` (`key`, `value`, `updated_at`)
SELECT 'serverAccessOrder', json_array(json_extract(`value`, '$')), `updated_at`
FROM `app_settings_values`
WHERE `key` = 'defaultMachineAccess' AND json_type(`value`) = 'text'
ON CONFLICT (`key`) DO NOTHING;
