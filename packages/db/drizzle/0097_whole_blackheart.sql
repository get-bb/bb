ALTER TABLE `plugin_marketplaces` ADD `source_kind` text DEFAULT 'https' NOT NULL;--> statement-breakpoint
ALTER TABLE `plugin_marketplaces` ADD `source_git_ref` text;--> statement-breakpoint
ALTER TABLE `plugin_marketplaces` ADD `source_git_commit` text;