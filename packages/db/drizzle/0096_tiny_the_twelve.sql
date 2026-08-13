CREATE TABLE IF NOT EXISTS `thread_handoff_archive_effects` (
	`handoff_id` text NOT NULL,
	`effect_key` text NOT NULL,
	`effect_type` text NOT NULL,
	`payload` text NOT NULL,
	`claim_token` text,
	`claim_expires_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`handoff_id`, `effect_key`),
	FOREIGN KEY (`handoff_id`) REFERENCES `thread_handoffs`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "thread_handoff_archive_effects_claim_shape_check" CHECK((
        ("thread_handoff_archive_effects"."completed_at" IS NULL)
        OR
        (
          "thread_handoff_archive_effects"."claim_token" IS NULL
          AND "thread_handoff_archive_effects"."claim_expires_at" IS NULL
        )
      ))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `thread_handoff_archive_effects_pending_idx` ON `thread_handoff_archive_effects` (`completed_at`,`claim_expires_at`,`created_at`,`handoff_id`,`effect_key`);
