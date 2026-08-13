import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import {
  claimDevice,
  DeviceClaimError,
  listClaimEvents,
  refreshClaim,
  releaseDevice,
} from "./claims.js";
import { getDevice, upsertCandidate } from "./store.js";

const databases: Database.Database[] = [];
const directories: string[] = [];

function createConnection(path = ":memory:"): Database.Database {
  const db = new Database(path);
  db.pragma("busy_timeout = 1000");
  databases.push(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.transaction(() => {
    for (const statement of MIGRATIONS) db.exec(statement);
  })();
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const scope = { projectId: "project-1", projectVersionId: "version-1" };

function seed(db: Database.Database): string {
  return upsertCandidate(db, scope, "probe-rs", "probe", {
    stableIdentity: "probe-serial",
    make: "Arm",
    model: "CMSIS-DAP",
    connection: "usb:probe-serial",
    transport: "local-usb",
  }, "2026-08-13T10:00:00.000Z").deviceId;
}

describe("device claim arbitration", () => {
  it("gives exactly one of two SQLite writers the device and names the winner", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fs123-claims-"));
    directories.push(directory);
    const path = join(directory, "registry.sqlite");
    const writerA = createConnection(path);
    migrate(writerA);
    const deviceId = seed(writerA);
    const writerB = createConnection(path);

    const attempts = await Promise.allSettled([
      Promise.resolve().then(() => claimDevice(writerA, deviceId, "thread-a", { scope })),
      Promise.resolve().then(() => claimDevice(writerB, deviceId, "thread-b", { scope })),
    ]);
    const winners = attempts.filter((attempt) => attempt.status === "fulfilled");
    const losers = attempts.filter((attempt) => attempt.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    const holder = getDevice(writerA, scope, deviceId)?.claimedBy;
    expect(holder === "thread-a" || holder === "thread-b").toBe(true);
    const loserReason = losers[0]?.status === "rejected" ? losers[0].reason : null;
    expect(loserReason).toBeInstanceOf(DeviceClaimError);
    expect(loserReason).toMatchObject({ code: "DEVICE_CLAIMED", holder });
    expect(loserReason).toHaveProperty("message", expect.stringContaining(holder ?? "missing-holder"));
  });

  it("rejects non-holder release, releases idempotently, and records expiry", () => {
    const db = createConnection(":memory:");
    migrate(db);
    const deviceId = seed(db);
    claimDevice(db, deviceId, "thread-a", {
      scope,
      now: new Date("2026-08-13T10:00:00.000Z"),
    });
    expect(() => releaseDevice(db, deviceId, "thread-b", {
      scope,
      now: new Date("2026-08-13T10:01:00.000Z"),
    })).toThrow(expect.objectContaining({ code: "DEVICE_NOT_HELD", holder: "thread-a" }));
    const releaseOptions = {
      scope,
      now: new Date("2026-08-13T10:02:00.000Z"),
    };
    expect(releaseDevice(db, deviceId, "thread-a", releaseOptions).outcome).toBe("released");
    expect(releaseDevice(db, deviceId, "thread-a", releaseOptions).outcome).toBe("already_free");

    claimDevice(db, deviceId, "thread-expired", {
      scope,
      now: new Date("2026-08-13T11:00:00.000Z"),
    });
    const next = claimDevice(db, deviceId, "thread-next", {
      scope,
      now: new Date("2026-08-13T11:15:00.000Z"),
    });
    expect(next).toMatchObject({ outcome: "claimed", expiredHolders: ["thread-expired"] });
    expect(listClaimEvents(db, deviceId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ holder: "thread-expired", reason: "expired" }),
      ]),
    );
  });

  it("refresh extends the explicit fifteen-minute deadline", () => {
    const db = createConnection(":memory:");
    migrate(db);
    const deviceId = seed(db);
    claimDevice(db, deviceId, "thread-a", {
      scope,
      now: new Date("2026-08-13T10:00:00.000Z"),
    });
    refreshClaim(db, deviceId, "thread-a", {
      scope,
      now: new Date("2026-08-13T10:14:00.000Z"),
    });
    expect(() => claimDevice(db, deviceId, "thread-b", {
      scope,
      now: new Date("2026-08-13T10:20:00.000Z"),
    })).toThrow(expect.objectContaining({ code: "DEVICE_CLAIMED", holder: "thread-a" }));
  });
});
