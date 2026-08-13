import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import type { FamilyStatus } from "./families.js";
import {
  getDevice,
  listDevices,
  recordFamilyStatus,
  stableDeviceId,
  upsertCandidate,
} from "./store.js";

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

const scope = { projectId: "project-1", projectVersionId: "version-1" };
const family = (checkedAt: string): FamilyStatus => ({
  familyId: "probe-rs",
  kind: "probe",
  label: "Debug probes",
  availability: "available",
  reason: null,
  helper: { id: "probe-rs", displayName: "probe-rs", source: "https://probe.rs", why: "Detect probes" },
  needsConfiguration: false,
  checkedAt,
});

describe("debug-bench device store", () => {
  it("keeps identity stable, advances last_seen, and marks disappearance/recovery", () => {
    const db = createConnection(":memory:");
    migrate(db);
    const candidate = {
      stableIdentity: "SERIAL-ABC",
      make: "Arm",
      model: "CMSIS-DAP",
      connection: "usb:1-2",
      transport: "local-usb" as const,
    };
    const first = upsertCandidate(db, scope, "probe-rs", "probe", candidate, "2026-08-13T10:00:00.000Z");
    recordFamilyStatus(db, scope, family("2026-08-13T10:00:00.000Z"));
    recordFamilyStatus(db, scope, family("2026-08-13T10:05:00.000Z"));
    expect(getDevice(db, scope, first.deviceId)).toMatchObject({ stale: true, claimedBy: null });

    const recovered = upsertCandidate(
      db,
      scope,
      "probe-rs",
      "probe",
      { ...candidate, connection: "usb:9-9" },
      "2026-08-13T10:06:00.000Z",
    );
    expect(recovered).toMatchObject({
      deviceId: first.deviceId,
      connection: "usb:9-9",
      lastSeen: "2026-08-13T10:06:00.000Z",
      transport: "local-usb",
      claimScope: "machine",
      stale: false,
    });
    const lateOlderScan = upsertCandidate(
      db,
      scope,
      "probe-rs",
      "probe",
      candidate,
      "2026-08-13T10:03:00.000Z",
    );
    expect(lateOlderScan.lastSeen).toBe("2026-08-13T10:06:00.000Z");
  });

  it("round-trips transport and claim scope and pages by stable key", () => {
    const db = createConnection(":memory:");
    migrate(db);
    for (let index = 0; index < 3; index += 1) {
      upsertCandidate(db, scope, "scope-lan", "scope", {
        stableIdentity: `scope-${index}`,
        make: "Siglent",
        model: "SDS",
        connection: `lan:192.0.2.${index}:5025`,
        transport: "local-net",
      }, `2026-08-13T10:0${index}:00.000Z`, "fleet");
    }
    const first = listDevices(db, { ...scope, pageSize: 2 });
    const second = listDevices(db, { ...scope, pageSize: 2, cursor: first.cursor });
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transport: "local-net", claimScope: "fleet" }),
      ]),
    );
    expect(new Set([...first.items, ...second.items].map((item) => item.deviceId)).size).toBe(3);
    expect(stableDeviceId("scope-lan", "scope-0")).toBe(stableDeviceId("scope-lan", " SCOPE-0 "));
  });
});
