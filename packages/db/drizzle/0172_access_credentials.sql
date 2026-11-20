CREATE TABLE `access_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`label` text NOT NULL,
	`token_hash` text,
	`dpop_jkt` text,
	`parent_id` text,
	`secure_only` integer NOT NULL,
	`origin` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `access_credentials`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "access_credentials_kind_shape_check" CHECK(("access_credentials"."kind" = 'device') = ("access_credentials"."dpop_jkt" IS NOT NULL AND "access_credentials"."token_hash" IS NULL) AND ("access_credentials"."kind" = 'device-browser') = ("access_credentials"."parent_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_credentials_token_hash_unique` ON `access_credentials` (`token_hash`);--> statement-breakpoint
CREATE INDEX `access_credentials_parent_idx` ON `access_credentials` (`parent_id`);