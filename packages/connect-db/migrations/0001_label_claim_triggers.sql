-- Custom SQL migration: Postgres twin of the SQLite chain's custom pieces.
-- unixepoch() lets SQLite-dialect statements built by Drizzle run unchanged.
-- The label_claim triggers mirror migrations/0005_label_claim_triggers.sql.
CREATE FUNCTION unixepoch() RETURNS bigint
LANGUAGE sql STABLE
AS $$ SELECT floor(extract(epoch from now()))::bigint $$;
--> statement-breakpoint
CREATE FUNCTION label_claim_generation() RETURNS text
LANGUAGE sql VOLATILE
AS $$ SELECT replace(gen_random_uuid()::text, '-', '') $$;
--> statement-breakpoint
CREATE FUNCTION profile_label_claim_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "label_claim" ("label", "kind", "owner_id", "user_id", "generation", "created_at")
	VALUES (NEW."handle", 'handle', NEW."user_id", NEW."user_id", label_claim_generation(), NEW."created_at");
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "profile_label_claim_insert"
AFTER INSERT ON "profile"
FOR EACH ROW EXECUTE FUNCTION profile_label_claim_insert();
--> statement-breakpoint
CREATE FUNCTION profile_label_claim_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	DELETE FROM "label_claim"
	WHERE "label" = OLD."handle" AND "kind" = 'handle' AND "owner_id" = OLD."user_id";
	INSERT INTO "label_claim" ("label", "kind", "owner_id", "user_id", "generation", "created_at")
	SELECT OLD."handle", 'server', s."id", s."user_id", label_claim_generation(), s."created_at"
	FROM "server" s
	WHERE s."user_id" = OLD."user_id" AND s."subdomain" = OLD."handle";
	INSERT INTO "label_claim" ("label", "kind", "owner_id", "user_id", "generation", "created_at")
	VALUES (NEW."handle", 'handle', NEW."user_id", NEW."user_id", label_claim_generation(), NEW."created_at");
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "profile_label_claim_update"
AFTER UPDATE OF "handle" ON "profile"
FOR EACH ROW WHEN (OLD."handle" IS DISTINCT FROM NEW."handle")
EXECUTE FUNCTION profile_label_claim_update();
--> statement-breakpoint
CREATE FUNCTION profile_label_claim_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	DELETE FROM "label_claim"
	WHERE "label" = OLD."handle" AND "kind" = 'handle' AND "owner_id" = OLD."user_id";
	INSERT INTO "label_claim" ("label", "kind", "owner_id", "user_id", "generation", "created_at")
	SELECT OLD."handle", 'server', s."id", s."user_id", label_claim_generation(), s."created_at"
	FROM "server" s
	WHERE s."user_id" = OLD."user_id" AND s."subdomain" = OLD."handle";
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "profile_label_claim_delete"
AFTER DELETE ON "profile"
FOR EACH ROW EXECUTE FUNCTION profile_label_claim_delete();
--> statement-breakpoint
CREATE FUNCTION server_label_claim_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "profile"
		WHERE "user_id" = NEW."user_id" AND "handle" = NEW."subdomain"
	) THEN
		INSERT INTO "label_claim" ("label", "kind", "owner_id", "user_id", "generation", "created_at")
		VALUES (NEW."subdomain", 'server', NEW."id", NEW."user_id", label_claim_generation(), NEW."created_at");
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "server_label_claim_insert"
AFTER INSERT ON "server"
FOR EACH ROW EXECUTE FUNCTION server_label_claim_insert();
--> statement-breakpoint
CREATE FUNCTION server_label_claim_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	DELETE FROM "label_claim"
	WHERE "label" = OLD."subdomain" AND "kind" = 'server' AND "owner_id" = OLD."id";
	INSERT INTO "label_claim" ("label", "kind", "owner_id", "user_id", "generation", "created_at")
	SELECT NEW."subdomain", 'server', NEW."id", NEW."user_id", label_claim_generation(), NEW."created_at"
	WHERE NOT EXISTS (
		SELECT 1 FROM "profile"
		WHERE "user_id" = NEW."user_id" AND "handle" = NEW."subdomain"
	);
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "server_label_claim_update"
AFTER UPDATE OF "subdomain" ON "server"
FOR EACH ROW WHEN (OLD."subdomain" IS DISTINCT FROM NEW."subdomain")
EXECUTE FUNCTION server_label_claim_update();
--> statement-breakpoint
CREATE FUNCTION server_label_claim_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	DELETE FROM "label_claim"
	WHERE "label" = OLD."subdomain" AND "kind" = 'server' AND "owner_id" = OLD."id";
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "server_label_claim_delete"
AFTER DELETE ON "server"
FOR EACH ROW EXECUTE FUNCTION server_label_claim_delete();
--> statement-breakpoint
CREATE FUNCTION machine_label_claim_insert() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	INSERT INTO "label_claim" ("label", "kind", "owner_id", "user_id", "generation", "created_at")
	VALUES (NEW."subdomain", 'machine', NEW."id", NEW."user_id", label_claim_generation(), NEW."created_at");
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "machine_label_claim_insert"
AFTER INSERT ON "machine"
FOR EACH ROW WHEN (NEW."subdomain" IS NOT NULL)
EXECUTE FUNCTION machine_label_claim_insert();
--> statement-breakpoint
CREATE FUNCTION machine_label_claim_update() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	DELETE FROM "label_claim"
	WHERE "label" = OLD."subdomain" AND "kind" = 'machine' AND "owner_id" = OLD."id";
	IF NEW."subdomain" IS NOT NULL THEN
		INSERT INTO "label_claim" ("label", "kind", "owner_id", "user_id", "generation", "created_at")
		VALUES (NEW."subdomain", 'machine', NEW."id", NEW."user_id", label_claim_generation(), NEW."created_at");
	END IF;
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "machine_label_claim_update"
AFTER UPDATE OF "subdomain" ON "machine"
FOR EACH ROW WHEN (OLD."subdomain" IS DISTINCT FROM NEW."subdomain")
EXECUTE FUNCTION machine_label_claim_update();
--> statement-breakpoint
CREATE FUNCTION machine_label_claim_delete() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	DELETE FROM "label_claim"
	WHERE "label" = OLD."subdomain" AND "kind" = 'machine' AND "owner_id" = OLD."id";
	RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "machine_label_claim_delete"
AFTER DELETE ON "machine"
FOR EACH ROW WHEN (OLD."subdomain" IS NOT NULL)
EXECUTE FUNCTION machine_label_claim_delete();
