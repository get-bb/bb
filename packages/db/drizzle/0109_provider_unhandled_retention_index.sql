CREATE INDEX IF NOT EXISTS `events_provider_unhandled_created_idx` ON `events` (`created_at`,`id`) WHERE "events"."type" = 'provider/unhandled';
