CREATE TABLE `thread_submission_receipts` (
	`thread_id` text NOT NULL,
	`submission_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`queued_message` text NOT NULL,
	PRIMARY KEY(`thread_id`, `submission_id`),
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
