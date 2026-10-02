import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { authApiKeys, authUsers } from "@bb/db";
import { afterEach, describe, expect, it } from "vitest";
import { initDb } from "../src/db.js";
import { createMachineAuthService } from "../src/services/machine-auth.js";

const tempDirs: string[] = [];

const testLogger = {
  debug(): void {},
  error(): void {},
  info(): void {},
  warn(): void {},
};

async function makeTempDir(): Promise<string> {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-machine-auth-"));
  tempDirs.push(dataDir);
  return dataDir;
}

async function createMachineAuthHarness() {
  const dataDir = await makeTempDir();
  const db = initDb(":memory:");
  const machineAuth = await createMachineAuthService({
    dataDir,
    db,
    logger: testLogger,
  });
  await machineAuth.ensureReady();

  return {
    db,
    machineAuth,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })),
  );
});

describe("machine auth service", () => {
  it("persists both usage timestamps in one write per concurrent verification", async () => {
    const { db, machineAuth } = await createMachineAuthHarness();
    const token = await machineAuth.issueDaemonHostKey({
      hostId: "host_usage",
    });
    db.update(authApiKeys)
      .set({ lastRequest: new Date(0), updatedAt: new Date(0) })
      .run();
    db.$client.exec(`
      CREATE TABLE usage_writes (count INTEGER NOT NULL);
      INSERT INTO usage_writes VALUES (0);
      CREATE TRIGGER count_usage_writes AFTER UPDATE ON apikey
      BEGIN UPDATE usage_writes SET count = count + 1; END;
    `);
    const startedAt = Math.floor(Date.now() / 1000) * 1000;
    const results = await Promise.all(
      Array.from({ length: 12 }, () => machineAuth.verifyDaemonHostKey(token)),
    );
    expect(
      results.every((result) => result?.metadata.hostId === "host_usage"),
    ).toBe(true);
    expect(db.$client.prepare("SELECT count FROM usage_writes").get()).toEqual({
      count: 12,
    });
    const stored = db.select().from(authApiKeys).get();
    expect(stored?.lastRequest?.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(stored?.updatedAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    expect(stored?.remaining).toBeNull();
    expect(stored?.requestCount).toBe(0);
  });

  it.each(["invalid", "revoked", "expired"] as const)(
    "rejects %s credentials after a successful verification",
    async (kind) => {
      const { db, machineAuth } = await createMachineAuthHarness();
      const token = await machineAuth.issueDaemonHostKey({
        hostId: "host_rejected",
      });
      expect(await machineAuth.verifyDaemonHostKey(token)).not.toBeNull();
      if (kind === "revoked") {
        await machineAuth.revokeHostAuthKeys({ hostId: "host_rejected" });
      } else if (kind === "expired") {
        db.update(authApiKeys)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .run();
      }
      expect(
        await machineAuth.verifyDaemonHostKey(
          kind === "invalid" ? `${token}invalid` : token,
        ),
      ).toBeNull();
    },
  );

  it.each(["quota", "rate-limit"] as const)(
    "enforces %s under concurrent verification",
    async (kind) => {
      const { db, machineAuth } = await createMachineAuthHarness();
      const token = await machineAuth.issueDaemonHostKey({
        hostId: "host_limited",
      });
      db.update(authApiKeys)
        .set(
          kind === "quota"
            ? { remaining: 1 }
            : {
                rateLimitEnabled: true,
                rateLimitMax: 1,
                rateLimitTimeWindow: 60_000,
              },
        )
        .run();
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          machineAuth.verifyDaemonHostKey(token),
        ),
      );
      expect(results.filter((result) => result !== null)).toHaveLength(1);
      const stored = db.select().from(authApiKeys).get();
      if (kind === "rate-limit") expect(stored?.requestCount).toBe(1);
      else expect(stored?.remaining ?? 0).toBe(0);
    },
  );

  it("stores daemon host keys hashed at rest", async () => {
    const harness = await createMachineAuthHarness();

    const issuedKey = await harness.machineAuth.issueDaemonHostKey({
      hostId: "host_hashed",
    });

    const storedKey = harness.db
      .select({
        key: authApiKeys.key,
      })
      .from(authApiKeys)
      .where(eq(authApiKeys.configId, "daemon-host"))
      .get();

    expect(storedKey?.key).toBeTruthy();
    expect(storedKey?.key).not.toBe(issuedKey);
    expect(storedKey?.key).not.toContain("bbdh_");
  });

  it("revokes older daemon host keys when a host reenrolls", async () => {
    const harness = await createMachineAuthHarness();
    const hostId = "host_reenroll";
    const olderKey = await harness.machineAuth.issueDaemonHostKey({
      hostId,
    });
    const staleKey = await harness.machineAuth.issueDaemonHostKey({
      hostId,
    });
    const joinMaterial = await harness.machineAuth.issueHostEnrollKey({
      enrollSource: "loopback",
      hostId,
    });

    const reenrolled = await harness.machineAuth.enrollHost({
      hostId,
      token: joinMaterial.key,
    });

    expect(reenrolled).not.toBeNull();
    if (!reenrolled) {
      throw new Error("Expected reenrollment to succeed");
    }
    await expect(
      harness.machineAuth.verifyDaemonHostKey(olderKey),
    ).resolves.toBeNull();
    await expect(
      harness.machineAuth.verifyDaemonHostKey(staleKey),
    ).resolves.toBeNull();
    await expect(
      harness.machineAuth.verifyDaemonHostKey(reenrolled.hostKey),
    ).resolves.toMatchObject({
      metadata: {
        hostId,
      },
    });
  });

  it("prunes expired machine auth rows", async () => {
    const harness = await createMachineAuthHarness();
    await harness.machineAuth.issueHostEnrollKey({
      enrollSource: "loopback",
      hostId: "host_expired_key",
    });

    const createdKey = harness.db
      .select({
        id: authApiKeys.id,
      })
      .from(authApiKeys)
      .where(eq(authApiKeys.configId, "daemon-enroll"))
      .get();

    expect(createdKey?.id).toBeTruthy();

    await harness.db
      .update(authApiKeys)
      .set({
        expiresAt: new Date(Date.now() - 1_000),
      })
      .where(eq(authApiKeys.id, createdKey?.id ?? ""))
      .run();

    await harness.machineAuth.pruneExpiredKeys();

    const remainingKey = harness.db
      .select({
        id: authApiKeys.id,
      })
      .from(authApiKeys)
      .where(eq(authApiKeys.id, createdKey?.id ?? ""))
      .get();

    expect(remainingKey).toBeUndefined();
  });

  it("leaves expired non-machine api keys untouched when pruning", async () => {
    const harness = await createMachineAuthHarness();
    const systemUser = harness.db
      .select({
        id: authUsers.id,
      })
      .from(authUsers)
      .get();

    expect(systemUser?.id).toBeTruthy();
    if (!systemUser) {
      throw new Error("Expected machine auth system user");
    }
    await harness.db
      .insert(authApiKeys)
      .values({
        id: "apikey_owner_cli_expired",
        name: null,
        start: null,
        prefix: "bboc_",
        key: "hashed-owner-cli-key",
        referenceId: systemUser.id,
        refillInterval: null,
        refillAmount: null,
        lastRefillAt: null,
        enabled: true,
        rateLimitEnabled: false,
        rateLimitTimeWindow: 60_000,
        rateLimitMax: 100,
        requestCount: 0,
        remaining: null,
        lastRequest: null,
        expiresAt: new Date(Date.now() - 1_000),
        createdAt: new Date(),
        updatedAt: new Date(),
        permissions: null,
        metadata: null,
        configId: "owner-cli",
      })
      .run();

    await harness.machineAuth.pruneExpiredKeys();

    const remainingKey = harness.db
      .select({
        id: authApiKeys.id,
      })
      .from(authApiKeys)
      .where(eq(authApiKeys.id, "apikey_owner_cli_expired"))
      .get();

    expect(remainingKey).toMatchObject({
      id: "apikey_owner_cli_expired",
    });
  });
});
