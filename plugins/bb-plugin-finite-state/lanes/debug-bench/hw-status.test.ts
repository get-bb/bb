import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../lib/store/schema.js";
import { claimDevice } from "./registry/claims.js";
import type { FamilyStatus } from "./registry/families.js";
import { recordFamilyStatus, upsertCandidate } from "./registry/store.js";
import { getHwStatus, HW_STATUS_MAX_PAGE_SIZE } from "./hw-status.js";

const databases: Database.Database[] = [];

function createConnection(path = ":memory:"): Database.Database {
  const db = new Database(path);
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
});

describe("fs_hw_status", () => {
  it("projects expired claims as free without writing claim state or history", async () => {
    const db = createConnection(":memory:");
    migrate(db);
    const scope = { projectId: "project-1", projectVersionId: null };
    const device = upsertCandidate(db, scope, "serial", "serial", {
      stableIdentity: "serial-expired",
      make: null,
      model: "UART",
      connection: "tty:/dev/test-expired",
      transport: "local-usb",
    }, "2026-08-13T10:00:00.000Z");
    claimDevice(db, device.deviceId, "thread-expired", {
      scope,
      now: new Date("2026-08-13T10:00:00.000Z"),
    });
    const changesBefore = db.prepare<[], { changes: number }>("SELECT total_changes() AS changes").get()!.changes;
    const page = await getHwStatus(
      { ...scope, db, now: new Date("2026-08-13T10:16:00.000Z") },
      { ...scope, pageSize: 20 },
    );
    const changesAfter = db.prepare<[], { changes: number }>("SELECT total_changes() AS changes").get()!.changes;
    expect(page.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryType: "device",
        device: expect.objectContaining({ claimedBy: null, claimedAt: null }),
      }),
    ]));
    expect(changesAfter).toBe(changesBefore);
    expect(db.prepare("SELECT claimed_by FROM bench_device WHERE device_id = ?").get(device.deviceId))
      .toEqual({ claimed_by: "thread-expired" });
    expect(db.prepare("SELECT count(*) AS count FROM bench_claim_event").get()).toEqual({ count: 0 });
  });

  it("clamps budget, pages a 200-device registry, and includes holders and family reasons", async () => {
    const db = createConnection(":memory:");
    migrate(db);
    const scope = { projectId: "project-1", projectVersionId: null };
    const family: FamilyStatus = {
      familyId: "logic",
      kind: "logic",
      label: "Logic analyzers",
      availability: "unavailable",
      reason: "logic2-automation is not installed",
      helper: {
        id: "logic2-automation",
        displayName: "logic2-automation",
        source: "https://pypi.org/project/logic2-automation/",
        why: "Detect Saleae analyzers",
      },
      needsConfiguration: true,
      checkedAt: "2026-08-13T10:00:00.000Z",
    };
    recordFamilyStatus(db, scope, family);
    let claimedDeviceId = "";
    for (let index = 0; index < 200; index += 1) {
      const device = upsertCandidate(db, scope, "serial", "serial", {
        stableIdentity: `serial-${index.toString().padStart(3, "0")}`,
        make: "Acme",
        model: "UART",
        connection: `tty:/dev/test-${index}`,
        transport: "local-usb",
      }, "2026-08-13T10:00:00.000Z");
      if (index === 0) claimedDeviceId = device.deviceId;
    }
    claimDevice(db, claimedDeviceId, "thread-holder", {
      scope,
      now: new Date("2026-08-13T10:01:00.000Z"),
    });

    const first = await getHwStatus(
      { ...scope, db, now: new Date("2026-08-13T10:02:00.000Z") },
      { ...scope, pageSize: 200 },
    );
    expect(first).toMatchObject({
      total: 201,
      appliedPageSize: HW_STATUS_MAX_PAGE_SIZE,
      requestedPageSize: 200,
      clamped: true,
    });
    expect(first.items).toHaveLength(100);
    expect(first.items[0]).toEqual(expect.objectContaining({
      entryType: "family",
      family: expect.objectContaining({ reason: "logic2-automation is not installed" }),
    }));
    expect(first.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        entryType: "device",
        device: expect.objectContaining({ claimedBy: "thread-holder" }),
      }),
    ]));
    if (!first.cursor) throw new Error("expected first page cursor");
    const second = await getHwStatus(
      { ...scope, db, now: new Date("2026-08-13T10:02:00.000Z") },
      { ...scope, pageSize: 100, cursor: first.cursor },
    );
    if (!second.cursor) throw new Error("expected second page cursor");
    const third = await getHwStatus(
      { ...scope, db, now: new Date("2026-08-13T10:02:00.000Z") },
      { ...scope, pageSize: 100, cursor: second.cursor },
    );
    expect(second.items).toHaveLength(100);
    expect(third.items).toHaveLength(1);
    expect(third.cursor).toBeNull();
  });
});
