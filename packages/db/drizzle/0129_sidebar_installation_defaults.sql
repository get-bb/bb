CREATE TABLE `ui_preference_defaults` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `ui_preference_defaults` (`key`, `value_json`)
SELECT 'sidebar.organizationMode', '"project"'
WHERE EXISTS (SELECT 1 FROM `ui_preferences`)
   OR EXISTS (SELECT 1 FROM `projects` WHERE `kind` != 'personal')
   OR EXISTS (SELECT 1 FROM `threads`);
