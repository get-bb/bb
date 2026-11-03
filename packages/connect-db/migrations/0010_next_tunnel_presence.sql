ALTER TABLE `machine` ADD `next_tunnel_gate` text;--> statement-breakpoint
ALTER TABLE `machine` ADD `next_tunnel_region` text;--> statement-breakpoint
ALTER TABLE `machine` ADD `next_tunnel_at` integer;--> statement-breakpoint
ALTER TABLE `server` ADD `next_tunnel_gate` text;--> statement-breakpoint
ALTER TABLE `server` ADD `next_tunnel_region` text;--> statement-breakpoint
ALTER TABLE `server` ADD `next_tunnel_at` integer;