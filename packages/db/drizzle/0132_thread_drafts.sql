ALTER TABLE `threads` ADD `draft` text;
--> statement-breakpoint
UPDATE `threads` SET `draft` = (
	SELECT json_group_array(json(`parts`.`value`))
	FROM (
		SELECT `part`.`value` AS `value`
		FROM `queued_thread_messages` AS `q`, json_each(`q`.`content`) AS `part`
		WHERE `q`.`thread_id` = `threads`.`id`
			AND `q`.`wait_holder` = 'plugin:drafts'
			AND `q`.`payload_kind` = 'inline'
		ORDER BY `q`.`sort_key`, `q`.`id`, `part`.`key`
	) AS `parts`
)
WHERE EXISTS (
	SELECT 1 FROM `queued_thread_messages` AS `q`
	WHERE `q`.`thread_id` = `threads`.`id`
		AND `q`.`wait_holder` = 'plugin:drafts'
		AND `q`.`payload_kind` = 'inline'
);
--> statement-breakpoint
DELETE FROM `queued_thread_messages`
WHERE `wait_holder` = 'plugin:drafts' AND `payload_kind` = 'inline';
--> statement-breakpoint
DELETE FROM `plugins` WHERE `id` = 'drafts' AND `source_kind` = 'builtin';
