ALTER TABLE `environment_launches` ADD `claim_path` text;
--> statement-breakpoint
UPDATE `environment_launches` SET `claim_path` = CASE WHEN rtrim(`path`, '/') = '' THEN '/' ELSE rtrim(`path`, '/') END WHERE `path` IS NOT NULL;
