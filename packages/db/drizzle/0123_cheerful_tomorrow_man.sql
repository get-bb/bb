CREATE TABLE `environment_variables` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`ciphertext` text NOT NULL,
	`encryption_version` integer NOT NULL,
	`note` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `environment_variables_global_name` ON `environment_variables` (`name`) WHERE "environment_variables"."project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `environment_variables_project_name` ON `environment_variables` (`project_id`,`name`) WHERE "environment_variables"."project_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO environment_variables (project_id, name, ciphertext, encryption_version, note, updated_at)
SELECT NULL, json_extract(value, '$.name'), json_extract(value, '$.ciphertext'), json_extract(value, '$.version'), json_extract(value, '$.note'), updated_at
FROM app_settings_values WHERE key LIKE 'machineEnvironment:%';
--> statement-breakpoint
DELETE FROM app_settings_values WHERE key LIKE 'machineEnvironment:%';
