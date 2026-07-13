ALTER TABLE `machine` ADD `subdomain` text;--> statement-breakpoint
CREATE UNIQUE INDEX `machine_subdomain_unique` ON `machine` (`subdomain`);
