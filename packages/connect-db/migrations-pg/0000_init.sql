CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" bigint,
	"refresh_token_expires_at" bigint,
	"scope" text,
	"password" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_request_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"server_id" text,
	"model" text,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"cost_micros" bigint DEFAULT 0 NOT NULL,
	"latency_ms" integer NOT NULL,
	"outcome" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_day" (
	"user_id" text NOT NULL,
	"day" text NOT NULL,
	"spent_micros" bigint DEFAULT 0 NOT NULL,
	"reserved_micros" bigint DEFAULT 0 NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "ai_usage_day_user_id_day_pk" PRIMARY KEY("user_id","day")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"detail" text,
	"ip_address" text,
	"created_at" bigint DEFAULT (floor(extract(epoch from now())) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connect_code" (
	"code" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"server_id" text,
	"purpose" text NOT NULL,
	"device_code_hash" text,
	"client_name" text,
	"request_location" text,
	"delivered_credential_hash" text,
	"polled_at" bigint,
	"approved_at" bigint,
	"denied_at" bigint,
	"expires_at" bigint NOT NULL,
	"consumed_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "label_claim" (
	"label" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"user_id" text NOT NULL,
	"generation" text NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "machine" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text,
	"subdomain" text,
	"credential_hash" text NOT NULL,
	"last_seen_at" bigint,
	"next_tunnel_gate" text,
	"next_tunnel_region" text,
	"next_tunnel_at" bigint,
	"created_at" bigint NOT NULL,
	"revoked_at" bigint,
	CONSTRAINT "machine_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "oauth_code" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"server_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"redirect_uri" text NOT NULL,
	"resource" text NOT NULL,
	"scope" text NOT NULL,
	"code_challenge" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_grant" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"server_id" text NOT NULL,
	"client_id" text NOT NULL,
	"client_name" text NOT NULL,
	"resource" text NOT NULL,
	"scope" text NOT NULL,
	"created_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint
);
--> statement-breakpoint
CREATE TABLE "oauth_refresh_token" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"rotated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "profile" (
	"user_id" text PRIMARY KEY NOT NULL,
	"handle" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "profile_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "server" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'default' NOT NULL,
	"subdomain" text NOT NULL,
	"credential_hash" text,
	"version" text,
	"last_seen_at" bigint,
	"next_tunnel_gate" text,
	"next_tunnel_region" text,
	"next_tunnel_at" bigint,
	"created_at" bigint NOT NULL,
	"revoked_at" bigint,
	CONSTRAINT "server_subdomain_unique" UNIQUE("subdomain")
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"github_login" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" bigint NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_log" ADD CONSTRAINT "ai_request_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_request_log" ADD CONSTRAINT "ai_request_log_server_id_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_day" ADD CONSTRAINT "ai_usage_day_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connect_code" ADD CONSTRAINT "connect_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connect_code" ADD CONSTRAINT "connect_code_server_id_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label_claim" ADD CONSTRAINT "label_claim_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "machine" ADD CONSTRAINT "machine_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_code" ADD CONSTRAINT "oauth_code_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_code" ADD CONSTRAINT "oauth_code_server_id_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_grant" ADD CONSTRAINT "oauth_grant_server_id_server_id_fk" FOREIGN KEY ("server_id") REFERENCES "public"."server"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_refresh_token" ADD CONSTRAINT "oauth_refresh_token_grant_id_oauth_grant_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."oauth_grant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile" ADD CONSTRAINT "profile_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "server" ADD CONSTRAINT "server_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ai_request_log_created_at_idx" ON "ai_request_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_request_log_user_created_at_idx" ON "ai_request_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_usage_day_day_idx" ON "ai_usage_day" USING btree ("day");--> statement-breakpoint
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "connect_code_user_id_idx" ON "connect_code" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "connect_code_device_code_hash_idx" ON "connect_code" USING btree ("device_code_hash");--> statement-breakpoint
CREATE INDEX "label_claim_user_id_idx" ON "label_claim" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "machine_user_id_idx" ON "machine" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "machine_credential_hash_idx" ON "machine" USING btree ("credential_hash");--> statement-breakpoint
CREATE INDEX "oauth_code_expires_at_idx" ON "oauth_code" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "oauth_grant_user_id_idx" ON "oauth_grant" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "oauth_grant_server_id_idx" ON "oauth_grant" USING btree ("server_id");--> statement-breakpoint
CREATE INDEX "oauth_refresh_token_grant_id_idx" ON "oauth_refresh_token" USING btree ("grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "server_user_name_idx" ON "server" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "server_credential_hash_idx" ON "server" USING btree ("credential_hash");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");