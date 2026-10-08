CREATE TABLE `thread_pruning_work` (
	`policy` text NOT NULL,
	`thread_id` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`policy`, `thread_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `thread_pruning_work_thread_idx` ON `thread_pruning_work` (`thread_id`);--> statement-breakpoint
ALTER TABLE `thread_pruning_cursors` ADD `work_revision` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
INSERT INTO thread_pruning_work (policy, thread_id)
SELECT policy, threads.id
FROM threads CROSS JOIN (SELECT 'rate-limits' AS policy UNION ALL SELECT 'usage' UNION ALL SELECT 'turn-diffs' UNION ALL SELECT 'resolved-items');
