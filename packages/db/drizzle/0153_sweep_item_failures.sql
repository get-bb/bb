CREATE TABLE IF NOT EXISTS `sweep_item_failures` (
	`sweep` text NOT NULL,
	`item_key` text NOT NULL,
	`attempts` integer NOT NULL,
	`first_failed_at` integer NOT NULL,
	`retry_at` integer NOT NULL,
	`last_error` text NOT NULL,
	PRIMARY KEY(`sweep`, `item_key`)
);
