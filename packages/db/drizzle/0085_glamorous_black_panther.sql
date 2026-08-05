ALTER TABLE `app_settings` ADD `onboarding_completed_at` text;--> statement-breakpoint
-- Existing installs predate first-run onboarding, so stamp them as already
-- onboarded rather than showing a setup flow to someone mid-project. Having a
-- real (non-personal) project is the signal: it can only exist if the user has
-- already set bb up. Doing this here, once, rather than in the client keeps
-- `onboarding_completed_at IS NULL` meaning exactly one thing afterwards —
-- "show the flow" — so Settings can re-trigger it by clearing the column.
-- The settings row only exists once something has been saved, so an existing
-- user can have projects and no row at all. Insert before updating, or the
-- backfill silently matches nothing and the upgrade still gets onboarding.
INSERT INTO `app_settings` (`id`, `updated_at`)
SELECT 'current', CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE NOT EXISTS (SELECT 1 FROM `app_settings` WHERE `id` = 'current')
  AND EXISTS (SELECT 1 FROM `projects` WHERE `kind` != 'personal');--> statement-breakpoint
UPDATE `app_settings`
SET `onboarding_completed_at` = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE `onboarding_completed_at` IS NULL
  AND EXISTS (SELECT 1 FROM `projects` WHERE `kind` != 'personal');
