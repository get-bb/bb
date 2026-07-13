import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONNECT_CODE_TTL_MS,
  checkLabelAvailability,
  connectCode,
  machine,
  parseVisitorHost,
  profile,
  schema,
  server,
  user,
  validateHandle,
  validateSubdomain,
} from "../src/index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/** Migration files in lexical (apply) order. */
function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function applyMigration(sqlite: Database.Database, file: string): void {
  sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
}

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle>;

beforeEach(() => {
  sqlite = new Database(":memory:");
  sqlite.pragma("foreign_keys = ON");
  for (const file of readdirSync(MIGRATIONS_DIR).sort()) {
    if (!file.endsWith(".sql")) continue;
    sqlite.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  db = drizzle(sqlite, { schema });
});

afterEach(() => {
  sqlite.close();
});

function seedUser(id = "u1"): void {
  const now = new Date();
  db.insert(user)
    .values({
      id,
      name: "Test",
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    })
    .run();
}

describe("migration matches the drizzle schema", () => {
  it("drizzle inserts/reads round-trip against the hand-written DDL", () => {
    seedUser();
    const now = new Date();
    db.insert(profile)
      .values({ userId: "u1", handle: "sawyer", createdAt: now })
      .run();
    db.insert(server)
      .values({
        id: "s1",
        userId: "u1",
        name: "default",
        subdomain: "sawyer",
        createdAt: now,
      })
      .run();

    const rows = db.select().from(server).where(eq(server.userId, "u1")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("default");
    expect(rows[0].subdomain).toBe("sawyer");
    expect(rows[0].lastSeenAt).toBeNull();
    expect(rows[0].revokedAt).toBeNull();

    db.insert(machine)
      .values({
        id: "m1",
        userId: "u1",
        name: "laptop",
        subdomain: "sawyer-air",
        credentialHash: "machine-hash",
        createdAt: now,
      })
      .run();
    expect(db.select().from(machine).get()?.subdomain).toBe("sawyer-air");

    const p = db
      .select()
      .from(profile)
      .where(eq(profile.handle, "sawyer"))
      .get();
    expect(p?.userId).toBe("u1");
  });

  it("stores the github login on user (nullable for pre-migration rows)", () => {
    seedUser("u1");
    expect(
      db.select().from(user).where(eq(user.id, "u1")).get()?.githubLogin,
    ).toBeNull();

    db.update(user)
      .set({ githubLogin: "sawyerhood" })
      .where(eq(user.id, "u1"))
      .run();
    expect(
      db.select().from(user).where(eq(user.id, "u1")).get()?.githubLogin,
    ).toBe("sawyerhood");
  });
});

describe("constraints", () => {
  it("enforces unique handles", () => {
    seedUser("u1");
    seedUser("u2");
    const now = new Date();
    db.insert(profile)
      .values({ userId: "u1", handle: "taken", createdAt: now })
      .run();
    expect(() =>
      db
        .insert(profile)
        .values({ userId: "u2", handle: "taken", createdAt: now })
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it("allows nullable machine labels and enforces uniqueness when assigned", () => {
    seedUser("u1");
    const now = new Date();
    db.insert(machine)
      .values([
        {
          id: "m1",
          userId: "u1",
          subdomain: "sawyer-air",
          credentialHash: "h1",
          createdAt: now,
        },
        {
          id: "m2",
          userId: "u1",
          subdomain: null,
          credentialHash: "h2",
          createdAt: now,
        },
      ])
      .run();
    expect(() =>
      db
        .insert(machine)
        .values({
          id: "m3",
          userId: "u1",
          subdomain: "sawyer-air",
          credentialHash: "h3",
          createdAt: now,
        })
        .run(),
    ).toThrow(/UNIQUE/iu);
  });

  it("enforces one server name per user but allows the same name across users", () => {
    seedUser("u1");
    seedUser("u2");
    const now = new Date();
    db.insert(server)
      .values({
        id: "s1",
        userId: "u1",
        name: "default",
        subdomain: "u1-default",
        createdAt: now,
      })
      .run();
    // Same (user, name) — rejected by the user_name unique index (distinct
    // subdomain so this targets the name index, not the subdomain constraint).
    expect(() =>
      db
        .insert(server)
        .values({
          id: "s2",
          userId: "u1",
          name: "default",
          subdomain: "u1-second",
          createdAt: now,
        })
        .run(),
    ).toThrow(/UNIQUE/i);
    // Different user, same name — allowed (N-ready schema).
    expect(() =>
      db
        .insert(server)
        .values({
          id: "s3",
          userId: "u2",
          name: "default",
          subdomain: "u2-default",
          createdAt: now,
        })
        .run(),
    ).not.toThrow();
  });

  it("enforces globally-unique subdomains across servers", () => {
    seedUser("u1");
    seedUser("u2");
    const now = new Date();
    db.insert(server)
      .values({
        id: "s1",
        userId: "u1",
        name: "default",
        subdomain: "taken",
        createdAt: now,
      })
      .run();
    // Same subdomain, different user + different name — still rejected: the
    // namespace is global, not per-account.
    expect(() =>
      db
        .insert(server)
        .values({
          id: "s2",
          userId: "u2",
          name: "laptop",
          subdomain: "taken",
          createdAt: now,
        })
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it("lets one account own several servers, each with its own subdomain", () => {
    seedUser("u1");
    const now = new Date();
    db.insert(profile)
      .values({ userId: "u1", handle: "sawyer", createdAt: now })
      .run();
    db.insert(server)
      .values({
        id: "s1",
        userId: "u1",
        name: "default",
        subdomain: "sawyer",
        createdAt: now,
      })
      .run();
    expect(() =>
      db
        .insert(server)
        .values({
          id: "s2",
          userId: "u1",
          name: "desktop",
          subdomain: "sawyer-desktop",
          createdAt: now,
        })
        .run(),
    ).not.toThrow();
    expect(
      db.select().from(server).where(eq(server.userId, "u1")).all(),
    ).toHaveLength(2);
  });

  it("cascades connect codes and servers when a user is deleted", () => {
    seedUser();
    const now = new Date();
    db.insert(server)
      .values({
        id: "s1",
        userId: "u1",
        name: "default",
        subdomain: "sawyer",
        createdAt: now,
      })
      .run();
    db.insert(connectCode)
      .values({
        code: "abc",
        userId: "u1",
        serverId: "s1",
        purpose: "server-pair",
        expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS),
        createdAt: now,
      })
      .run();

    db.delete(user).where(eq(user.id, "u1")).run();
    expect(db.select().from(server).all()).toHaveLength(0);
    expect(db.select().from(connectCode).all()).toHaveLength(0);
  });

  it("marks a connect code consumed exactly once (single-use redemption)", () => {
    seedUser();
    const now = new Date();
    db.insert(connectCode)
      .values({
        code: "one-time",
        userId: "u1",
        purpose: "manual-pair",
        expiresAt: new Date(now.getTime() + CONNECT_CODE_TTL_MS),
        createdAt: now,
      })
      .run();

    // Redemption pattern: conditional update on not-yet-consumed.
    const redeem = () =>
      db
        .update(connectCode)
        .set({ consumedAt: new Date() })
        .where(
          and(eq(connectCode.code, "one-time"), isNull(connectCode.consumedAt)),
        )
        .run();

    const first = redeem();
    expect(first.changes).toBe(1);
    const second = redeem();
    expect(second.changes).toBe(0);
  });
});

describe("validateHandle", () => {
  it("accepts well-formed handles", () => {
    for (const h of ["sawyer", "abc", "a1b2", "my-server", "x".repeat(30)]) {
      expect(validateHandle(h)).toBeNull();
    }
  });

  it("rejects malformed and reserved handles", () => {
    expect(validateHandle("ab")).toBe("too-short");
    expect(validateHandle("x".repeat(31))).toBe("too-long");
    expect(validateHandle("-lead")).toBe("invalid-format");
    expect(validateHandle("Upper")).toBe("invalid-format");
    expect(validateHandle("has space")).toBe("invalid-format");
    expect(validateHandle("has_underscore")).toBe("invalid-format");
    // `--` is reserved as the host-label separator for port shares.
    expect(validateHandle("foo--bar")).toBe("invalid-format");
    expect(validateHandle("a--b")).toBe("invalid-format");
    expect(validateHandle("api")).toBe("reserved");
    expect(validateHandle("www")).toBe("reserved");
    expect(validateHandle("admin")).toBe("reserved");
  });
});

describe("parseVisitorHost", () => {
  it("extracts a bare handle", () => {
    expect(parseVisitorHost("sawyer.getbb.app", "getbb.app")).toEqual({
      handle: "sawyer",
      target: null,
    });
    expect(parseVisitorHost("Sawyer.getbb.app", "getbb.app")).toEqual({
      handle: "sawyer",
      target: null,
    });
  });

  it("extracts handle--port share hosts", () => {
    expect(parseVisitorHost("sawyer--8000.getbb.app", "getbb.app")).toEqual({
      handle: "sawyer",
      target: "8000",
    });
    expect(parseVisitorHost("Sawyer--5173.getbb.app", "getbb.app")).toEqual({
      handle: "sawyer",
      target: "5173",
    });
  });

  it("rejects invalid share targets as unroutable", () => {
    expect(parseVisitorHost("sawyer--0.getbb.app", "getbb.app")).toBeNull();
    expect(parseVisitorHost("sawyer--99999.getbb.app", "getbb.app")).toBeNull();
    expect(parseVisitorHost("sawyer--08000.getbb.app", "getbb.app")).toBeNull();
    expect(parseVisitorHost("sawyer--x.getbb.app", "getbb.app")).toBeNull();
    // Multi `--`: first split only; suffix is not a valid port → null.
    expect(parseVisitorHost("foo--80--00.getbb.app", "getbb.app")).toBeNull();
  });

  it("rejects the apex, multi-label, and foreign hosts", () => {
    expect(parseVisitorHost("getbb.app", "getbb.app")).toBeNull();
    expect(parseVisitorHost("a.b.getbb.app", "getbb.app")).toBeNull();
    expect(parseVisitorHost("evil.com", "getbb.app")).toBeNull();
    expect(parseVisitorHost("getbb.app.evil.com", "getbb.app")).toBeNull();
  });
});

describe("validateSubdomain (shares the handle grammar)", () => {
  it("rejects `--`, reserved words, and bad charset the same way handles do", () => {
    expect(validateSubdomain("sawyer-desktop")).toBeNull();
    expect(validateSubdomain("foo--bar")).toBe("invalid-format");
    expect(validateSubdomain("Upper")).toBe("invalid-format");
    expect(validateSubdomain("has_underscore")).toBe("invalid-format");
    expect(validateSubdomain("ab")).toBe("too-short");
    expect(validateSubdomain("admin")).toBe("reserved");
  });
});

describe("0003 backfill (staged application on real prior data)", () => {
  it("backfills server.subdomain from the owner's handle before enforcing NOT NULL/UNIQUE", () => {
    const staged = new Database(":memory:");
    staged.pragma("foreign_keys = ON");
    try {
      // Apply everything BEFORE 0003, then seed pre-multi-server rows (a server
      // with no subdomain column yet), then apply 0003 and check the backfill.
      const files = migrationFiles();
      const subdomainMigration = "0003_server_subdomain.sql";
      const priorFiles = files.filter((f) => f < subdomainMigration);
      expect(priorFiles.length).toBeGreaterThan(0);
      for (const f of priorFiles) applyMigration(staged, f);

      const now = Date.now();
      staged
        .prepare(
          "INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?,?,?,?,?,?)",
        )
        .run("u1", "Test", "u1@example.com", 1, now, now);
      staged
        .prepare(
          "INSERT INTO profile (user_id, handle, created_at) VALUES (?,?,?)",
        )
        .run("u1", "sawyer", now);
      staged
        .prepare(
          "INSERT INTO server (id, user_id, name, created_at) VALUES (?,?,?,?)",
        )
        .run("s1", "u1", "default", now);
      // A pending pair code references the server — it must survive the rebuild
      // (the FK-guarded swap must not cascade-delete it).
      staged
        .prepare(
          "INSERT INTO connect_code (code, user_id, server_id, purpose, expires_at, created_at) VALUES (?,?,?,?,?,?)",
        )
        .run(
          "CODE1",
          "u1",
          "s1",
          "server-pair",
          now + CONNECT_CODE_TTL_MS,
          now,
        );

      applyMigration(staged, subdomainMigration);

      const row = staged
        .prepare("SELECT subdomain FROM server WHERE id = ?")
        .get("s1") as {
        subdomain: string;
      };
      expect(row.subdomain).toBe("sawyer");

      const codes = staged
        .prepare("SELECT server_id FROM connect_code")
        .all() as {
        server_id: string;
      }[];
      expect(codes).toHaveLength(1);
      expect(codes[0].server_id).toBe("s1");

      // Post-migration the column is NOT NULL + UNIQUE.
      expect(() =>
        staged
          .prepare(
            "INSERT INTO server (id, user_id, name, created_at) VALUES (?,?,?,?)",
          )
          .run("s2", "u1", "laptop", now),
      ).toThrow(/NOT NULL/i);
    } finally {
      staged.close();
    }
  });

  it("applies the full migration chain from scratch cleanly", () => {
    const fresh = new Database(":memory:");
    fresh.pragma("foreign_keys = ON");
    try {
      for (const f of migrationFiles()) applyMigration(fresh, f);
      const cols = fresh.prepare("PRAGMA table_info(server)").all() as {
        name: string;
        notnull: number;
      }[];
      const subdomainCol = cols.find((c) => c.name === "subdomain");
      expect(subdomainCol).toBeDefined();
      expect(subdomainCol?.notnull).toBe(1);
      const machineCols = fresh.prepare("PRAGMA table_info(machine)").all() as {
        name: string;
        notnull: number;
      }[];
      const machineSubdomain = machineCols.find((c) => c.name === "subdomain");
      expect(machineSubdomain).toBeDefined();
      expect(machineSubdomain?.notnull).toBe(0);
    } finally {
      fresh.close();
    }
  });
});

describe("checkLabelAvailability (all routing namespaces)", () => {
  it("reports a free, well-formed label available", async () => {
    seedUser();
    expect(await checkLabelAvailability(db, "sawyer-desktop")).toEqual({
      available: true,
      label: "sawyer-desktop",
    });
  });

  it("normalizes case/whitespace before checking", async () => {
    const result = await checkLabelAvailability(db, "  Sawyer-Desktop  ");
    expect(result).toEqual({ available: true, label: "sawyer-desktop" });
  });

  it("rejects invalid labels with the grammar reason (reserved, `--`, charset)", async () => {
    expect(await checkLabelAvailability(db, "admin")).toEqual({
      available: false,
      reason: "invalid",
      error: "reserved",
    });
    expect(await checkLabelAvailability(db, "foo--bar")).toEqual({
      available: false,
      reason: "invalid",
      error: "invalid-format",
    });
    expect(await checkLabelAvailability(db, "ab")).toEqual({
      available: false,
      reason: "invalid",
      error: "too-short",
    });
  });

  it("reports a label taken by an existing handle", async () => {
    seedUser("u1");
    const now = new Date();
    db.insert(profile)
      .values({ userId: "u1", handle: "sawyer", createdAt: now })
      .run();
    expect(await checkLabelAvailability(db, "sawyer")).toEqual({
      available: false,
      reason: "taken",
      namespace: "handle",
    });
  });

  it("reports a label taken by an existing server subdomain", async () => {
    seedUser("u1");
    const now = new Date();
    db.insert(profile)
      .values({ userId: "u1", handle: "sawyer", createdAt: now })
      .run();
    db.insert(server)
      .values({
        id: "s1",
        userId: "u1",
        name: "desktop",
        subdomain: "sawyer-desktop",
        createdAt: now,
      })
      .run();
    expect(await checkLabelAvailability(db, "sawyer-desktop")).toEqual({
      available: false,
      reason: "taken",
      namespace: "subdomain",
    });
  });

  it("reports a label taken by an existing machine subdomain", async () => {
    seedUser("u1");
    const now = new Date();
    db.insert(machine)
      .values({
        id: "m1",
        userId: "u1",
        subdomain: "sawyer-air",
        credentialHash: "hash",
        createdAt: now,
      })
      .run();
    expect(await checkLabelAvailability(db, "sawyer-air")).toEqual({
      available: false,
      reason: "taken",
      namespace: "machine",
    });
  });
});
