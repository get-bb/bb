-- The marketplace BB curates was registered as `bb-official` and now lists as
-- `bb-community`. The name is a key, not a label: the row, its cached icons,
-- and every catalog install that traces back to it move together, or a refresh
-- would register a second row and the store would list every entry twice.
--
-- No released BB registers this marketplace, so this only migrates development
-- databases — but every one of those has the row, because BB registers it on
-- startup.
UPDATE `plugin_marketplace_icons`
SET `marketplace_name` = 'bb-community'
WHERE `marketplace_name` = 'bb-official';--> statement-breakpoint
UPDATE `plugins`
SET `catalog_marketplace_name` = 'bb-community'
WHERE `catalog_marketplace_name` = 'bb-official';--> statement-breakpoint
UPDATE `plugin_marketplaces`
SET `name` = 'bb-community'
WHERE `name` = 'bb-official';
