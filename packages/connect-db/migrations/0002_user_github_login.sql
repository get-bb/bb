-- bb connect — GitHub username on user, for the invite-only signup allowlist.
-- See src/schema.ts `user.githubLogin`.

ALTER TABLE user ADD COLUMN github_login text;
