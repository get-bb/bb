-- bb connect — GitHub username on user, refreshed from the OAuth profile.
-- See src/schema.ts `user.githubLogin`.

ALTER TABLE user ADD COLUMN github_login text;
