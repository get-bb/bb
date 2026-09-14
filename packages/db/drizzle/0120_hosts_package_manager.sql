ALTER TABLE `hosts` ADD `package_manager` text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
ALTER TABLE `hosts` ADD `package_manager_override` text;