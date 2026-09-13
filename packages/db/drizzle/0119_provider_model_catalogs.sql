CREATE TABLE `provider_model_catalogs` (
	`host_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`models_json` text NOT NULL,
	`selected_only_models_json` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`host_id`, `provider_id`, `scope_key`),
	FOREIGN KEY (`host_id`) REFERENCES `hosts`(`id`) ON UPDATE no action ON DELETE cascade
);
