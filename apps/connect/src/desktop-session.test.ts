import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  machine,
  schema,
  server,
  session,
  sha256Hex,
  user,
} from "@bb/connect-db";

import {
  DESKTOP_SESSION_TTL_MS,
  createDesktopSessionCookie,
  issueDesktopSessionCookie,
  verifyDesktopSessionCookie,
  type DesktopSessionAccount,
} from "./desktop-session.js";
import { resolveAccount, revokeServerCredential } from "./servers.js";
import { SECURE_SESSION_COOKIE } from "./cloud-dev.js";

const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../packages/connect-db/migrations", import.meta.url),
);
const SECRET = "test-secret";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

function seedUser(id: string): void {
  db.insert(user)
    .values({
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })
    .run();
}

async function seedMachine(userId: string): Promise<DesktopSessionAccount> {
  seedUser(userId);
  const credentialHash = await sha256Hex(`bbcm_${crypto.randomUUID()}`);
  db.insert(machine)
    .values({
      id: `machine-${userId}`,
      userId,
      credentialHash,
      createdAt: new Date(0),
    })
    .run();
  return { userId, grant: { kind: "machine", credentialHash } };
}

async function signedSessionCookie(token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(token),
  );
  return `${token}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
}

async function legacyDesktopCookie(
  userId: string,
  expiresAt: number,
): Promise<string> {
  const payload = Buffer.from(JSON.stringify({ expiresAt, userId })).toString(
    "base64url",
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return `${payload}.${Buffer.from(signature).toString("base64url")}`;
}

describe("desktop session cookie", () => {
  it("lasts seven days and asks for a rolling refresh once a day old", async () => {
    const account = await seedMachine("acct-roll");
    const mintedAt = Date.now();
    const cookie = await issueDesktopSessionCookie(
      account,
      {
        baseDomain: "getbb.app",
        name: "__Secure-bb-connect.desktop_session",
        secret: SECRET,
      },
      mintedAt,
    );
    expect(cookie.expiresAt).toBe(mintedAt + 7 * DAY_MS);
    expect(cookie.domain).toBe(".getbb.app");

    await expect(
      verifyDesktopSessionCookie(cookie.value, SECRET, db, mintedAt + HOUR_MS),
    ).resolves.toEqual({ userId: "acct-roll", refreshGrant: null });
    await expect(
      verifyDesktopSessionCookie(
        cookie.value,
        SECRET,
        db,
        mintedAt + DAY_MS + 1,
      ),
    ).resolves.toEqual({ userId: "acct-roll", refreshGrant: account.grant });
    await expect(
      verifyDesktopSessionCookie(cookie.value, SECRET, db, cookie.expiresAt),
    ).resolves.toBeNull();
    await expect(
      verifyDesktopSessionCookie(
        `${cookie.value.slice(0, -1)}x`,
        SECRET,
        db,
        mintedAt,
      ),
    ).resolves.toBeNull();
  });

  it("rejects a machine-minted cookie once the machine is revoked and the cache lapses", async () => {
    const account = await seedMachine("acct-revoke");
    const mintedAt = Date.now();
    const value = await createDesktopSessionCookie(
      account,
      SECRET,
      mintedAt + DESKTOP_SESSION_TTL_MS,
    );
    await expect(
      verifyDesktopSessionCookie(value, SECRET, db, mintedAt),
    ).resolves.toMatchObject({ userId: "acct-revoke" });

    db.update(machine)
      .set({ revokedAt: new Date(mintedAt) })
      .where(eq(machine.userId, "acct-revoke"))
      .run();

    await expect(
      verifyDesktopSessionCookie(value, SECRET, db, mintedAt + 1_000),
    ).resolves.toMatchObject({ userId: "acct-revoke" });
    await expect(
      verifyDesktopSessionCookie(value, SECRET, db, mintedAt + 21_000),
    ).resolves.toBeNull();
  });

  it("stops a server-minted cookie immediately on disconnect and after a credential rotation", async () => {
    seedUser("acct-server");
    const credential = "bbcred_server_cookie";
    db.insert(server)
      .values({
        id: "srv-cookie",
        userId: "acct-server",
        subdomain: "sawyer",
        credentialHash: await sha256Hex(credential),
        createdAt: new Date(0),
      })
      .run();
    const account = await resolveAccount(
      new Request("https://sawyer.getbb.app/api/connect/desktop-session", {
        headers: { "x-bb-connect-machine": credential },
      }),
      SECRET,
      db,
      SECURE_SESSION_COOKIE,
    );
    expect(account?.grant.kind).toBe("server");
    const mintedAt = Date.now();
    const value = await createDesktopSessionCookie(
      account!,
      SECRET,
      mintedAt + DESKTOP_SESSION_TTL_MS,
    );
    await expect(
      verifyDesktopSessionCookie(value, SECRET, db, mintedAt),
    ).resolves.toMatchObject({ userId: "acct-server" });

    await revokeServerCredential(credential, db);
    await expect(
      verifyDesktopSessionCookie(value, SECRET, db, mintedAt + 1_000),
    ).resolves.toBeNull();

    db.update(server)
      .set({
        credentialHash: await sha256Hex("bbcred_rotated"),
        revokedAt: null,
      })
      .where(eq(server.id, "srv-cookie"))
      .run();
    await expect(
      verifyDesktopSessionCookie(value, SECRET, db, mintedAt + 60_000),
    ).resolves.toBeNull();
  });

  it("rejects a browser-session-minted cookie once that session is signed out", async () => {
    seedUser("acct-browser");
    const token = `sess_${crypto.randomUUID()}`;
    db.insert(session)
      .values({
        id: "sess-browser",
        token,
        expiresAt: new Date(Date.now() + DESKTOP_SESSION_TTL_MS),
        userId: "acct-browser",
        createdAt: new Date(0),
        updatedAt: new Date(0),
      })
      .run();
    const account = await resolveAccount(
      new Request("https://sawyer.getbb.app/api/connect/desktop-session", {
        headers: {
          cookie: `${SECURE_SESSION_COOKIE}=${await signedSessionCookie(token)}`,
        },
      }),
      SECRET,
      db,
      SECURE_SESSION_COOKIE,
    );
    const mintedAt = Date.now();
    const value = await createDesktopSessionCookie(
      account!,
      SECRET,
      mintedAt + DESKTOP_SESSION_TTL_MS,
    );
    await expect(
      verifyDesktopSessionCookie(value, SECRET, db, mintedAt),
    ).resolves.toMatchObject({ userId: "acct-browser" });

    db.delete(session).where(eq(session.id, "sess-browser")).run();
    await expect(
      verifyDesktopSessionCookie(value, SECRET, db, mintedAt + 21_000),
    ).resolves.toBeNull();
  });

  it("keeps an already-issued one-hour cookie working until it expires", async () => {
    const issuedAt = Date.now();
    const legacy = await legacyDesktopCookie("acct-legacy", issuedAt + HOUR_MS);
    await expect(
      verifyDesktopSessionCookie(legacy, SECRET, db, issuedAt + 30 * 60_000),
    ).resolves.toEqual({ userId: "acct-legacy", refreshGrant: null });
    await expect(
      verifyDesktopSessionCookie(legacy, SECRET, db, issuedAt + HOUR_MS),
    ).resolves.toBeNull();

    const overlong = await legacyDesktopCookie(
      "acct-legacy",
      issuedAt + 7 * DAY_MS,
    );
    await expect(
      verifyDesktopSessionCookie(overlong, SECRET, db, issuedAt),
    ).resolves.toBeNull();
  });
});
