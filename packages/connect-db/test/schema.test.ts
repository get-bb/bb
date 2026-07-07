import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CONNECT_CODE_TTL_MS,
  connectCode,
  handleFromHost,
  isGithubUserAllowed,
  parseAllowedGithubUsers,
  profile,
  schema,
  server,
  user,
  validateHandle,
} from "../src/index.js";

const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

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
    db.insert(profile).values({ userId: "u1", handle: "sawyer", createdAt: now }).run();
    db.insert(server)
      .values({ id: "s1", userId: "u1", name: "default", createdAt: now })
      .run();

    const rows = db.select().from(server).where(eq(server.userId, "u1")).all();
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("default");
    expect(rows[0].lastSeenAt).toBeNull();
    expect(rows[0].revokedAt).toBeNull();

    const p = db.select().from(profile).where(eq(profile.handle, "sawyer")).get();
    expect(p?.userId).toBe("u1");
  });

  it("stores the github login on user (nullable for pre-migration rows)", () => {
    seedUser("u1");
    expect(db.select().from(user).where(eq(user.id, "u1")).get()?.githubLogin).toBeNull();

    db.update(user).set({ githubLogin: "sawyerhood" }).where(eq(user.id, "u1")).run();
    expect(db.select().from(user).where(eq(user.id, "u1")).get()?.githubLogin).toBe(
      "sawyerhood",
    );
  });
});

describe("constraints", () => {
  it("enforces unique handles", () => {
    seedUser("u1");
    seedUser("u2");
    const now = new Date();
    db.insert(profile).values({ userId: "u1", handle: "taken", createdAt: now }).run();
    expect(() =>
      db.insert(profile).values({ userId: "u2", handle: "taken", createdAt: now }).run(),
    ).toThrow(/UNIQUE/i);
  });

  it("enforces one server name per user but allows the same name across users", () => {
    seedUser("u1");
    seedUser("u2");
    const now = new Date();
    db.insert(server).values({ id: "s1", userId: "u1", name: "default", createdAt: now }).run();
    expect(() =>
      db.insert(server).values({ id: "s2", userId: "u1", name: "default", createdAt: now }).run(),
    ).toThrow(/UNIQUE/i);
    // Different user, same name — allowed (N-ready schema).
    expect(() =>
      db.insert(server).values({ id: "s3", userId: "u2", name: "default", createdAt: now }).run(),
    ).not.toThrow();
  });

  it("cascades connect codes and servers when a user is deleted", () => {
    seedUser();
    const now = new Date();
    db.insert(server).values({ id: "s1", userId: "u1", name: "default", createdAt: now }).run();
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
        .where(and(eq(connectCode.code, "one-time"), isNull(connectCode.consumedAt)))
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
    expect(validateHandle("api")).toBe("reserved");
    expect(validateHandle("www")).toBe("reserved");
    expect(validateHandle("admin")).toBe("reserved");
  });
});

describe("github signup allowlist", () => {
  it("parses a comma-separated var case-insensitively, ignoring blanks", () => {
    const allowed = parseAllowedGithubUsers(" SawyerHood, other-user, ,");
    expect(isGithubUserAllowed(allowed, "sawyerhood")).toBe(true);
    expect(isGithubUserAllowed(allowed, "SAWYERHOOD")).toBe(true);
    expect(isGithubUserAllowed(allowed, "other-user")).toBe(true);
    expect(isGithubUserAllowed(allowed, "stranger")).toBe(false);
  });

  it("fails closed: unset/empty var and null login are not allowed", () => {
    expect(isGithubUserAllowed(parseAllowedGithubUsers(undefined), "sawyerhood")).toBe(false);
    expect(isGithubUserAllowed(parseAllowedGithubUsers(""), "sawyerhood")).toBe(false);
    expect(isGithubUserAllowed(parseAllowedGithubUsers("sawyerhood"), null)).toBe(false);
    expect(isGithubUserAllowed(parseAllowedGithubUsers("sawyerhood"), undefined)).toBe(false);
  });
});

describe("handleFromHost", () => {
  it("extracts the handle label", () => {
    expect(handleFromHost("sawyer.getbb.app", "getbb.app")).toBe("sawyer");
    expect(handleFromHost("Sawyer.getbb.app", "getbb.app")).toBe("sawyer");
  });

  it("rejects the apex, www-style multi-label, and foreign hosts", () => {
    expect(handleFromHost("getbb.app", "getbb.app")).toBeNull();
    expect(handleFromHost("a.b.getbb.app", "getbb.app")).toBeNull();
    expect(handleFromHost("evil.com", "getbb.app")).toBeNull();
    expect(handleFromHost("getbb.app.evil.com", "getbb.app")).toBeNull();
  });
});
