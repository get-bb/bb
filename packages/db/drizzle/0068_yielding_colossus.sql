PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plugin_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`plugin_id` text NOT NULL,
	`source_kind` text NOT NULL,
	`npm_resolved_version` text,
	`git_resolved_commit` text,
	`path` text NOT NULL,
	`integrity` text,
	`content_hash` text,
	`validation_result` text NOT NULL,
	`validation_detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`validated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_plugin_artifacts`("id", "plugin_id", "source_kind", "npm_resolved_version", "git_resolved_commit", "path", "integrity", "content_hash", "validation_result", "validation_detail", "created_at", "updated_at", "validated_at") SELECT "id", "plugin_id", "source_kind", "npm_resolved_version", "git_resolved_commit", "path", "integrity", "content_hash", "validation_result", "validation_detail", "created_at", "updated_at", "validated_at" FROM `plugin_artifacts`;--> statement-breakpoint
DROP TABLE `plugin_artifacts`;--> statement-breakpoint
ALTER TABLE `__new_plugin_artifacts` RENAME TO `plugin_artifacts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `plugin_artifacts_plugin_idx` ON `plugin_artifacts` (`plugin_id`);