CREATE INDEX `machine_credential_hash_idx` ON `machine` (`credential_hash`);--> statement-breakpoint
CREATE INDEX `server_credential_hash_idx` ON `server` (`credential_hash`);