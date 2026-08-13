import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { enumerateDevices } from "./enumerate.js";
import type { FamilyAdapter, FamilyDescriptor } from "./families.js";

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

function descriptor(id: string, kind: FamilyDescriptor["kind"]): FamilyDescriptor {
  return {
    id,
    kind,
    label: id,
    detectionStrategy: "scripted test detector",
    helper: {
      id: `${id}-helper`,
      displayName: `${id} helper`,
      source: "https://example.invalid/helper",
      why: "Test family helper",
      check: ["false"],
      install: ["false"],
    },
    transports: ["local-usb"],
  };
}

describe("per-family enumeration", () => {
  it("isolates missing tooling and thrown adapters from a working family", async () => {
    const db = createConnection(":memory:");
    migrate(db);
    const adapters: FamilyAdapter[] = [
      {
        descriptor: descriptor("working", "serial"),
        async enumerate() {
          return [{
            stableIdentity: "serial-1",
            make: "Acme",
            model: "UART",
            connection: "tty:/dev/test",
            transport: "local-usb",
          }];
        },
      },
      {
        descriptor: descriptor("missing", "logic"),
        async enumerate() { throw new Error("must not run"); },
      },
      {
        descriptor: descriptor("flaky", "scope"),
        async enumerate() { throw new Error("vendor service stopped"); },
      },
    ];
    const result = await enumerateDevices({
      db,
      projectId: "project-1",
      projectVersionId: null,
      families: adapters,
      helperProbe: async (helper) => helper.id.startsWith("missing")
        ? { available: false, reason: "helper missing" }
        : { available: true, reason: null },
      now: () => new Date("2026-08-13T10:00:00.000Z"),
    });
    expect(result.devices).toHaveLength(1);
    expect(result.families).toEqual(expect.arrayContaining([
      expect.objectContaining({ familyId: "working", availability: "available" }),
      expect.objectContaining({ familyId: "missing", availability: "unavailable", needsConfiguration: true, reason: "helper missing" }),
      expect.objectContaining({ familyId: "flaky", availability: "unavailable", needsConfiguration: false, reason: expect.stringContaining("vendor service stopped") }),
    ]));
  });

  it("keeps identity stable, marks absence stale, and recovers on reappearance", async () => {
    const db = createConnection(":memory:");
    migrate(db);
    let present = true;
    const adapter: FamilyAdapter = {
      descriptor: descriptor("probe", "probe"),
      async enumerate() {
        return present ? [{
          stableIdentity: "stable-serial",
          make: null,
          model: "Probe",
          connection: "usb:first",
          transport: "local-usb",
        }] : [];
      },
    };
    let minute = 0;
    const ctx = {
      db,
      projectId: "project-1",
      projectVersionId: null,
      families: [adapter],
      helperProbe: async () => ({ available: true, reason: null }),
      now: () => new Date(`2026-08-13T10:0${minute}:00.000Z`),
    };
    const first = await enumerateDevices(ctx);
    present = false;
    minute = 1;
    const absent = await enumerateDevices(ctx);
    present = true;
    minute = 2;
    const recovered = await enumerateDevices(ctx);
    expect(absent.devices[0]).toMatchObject({ deviceId: first.devices[0]?.deviceId, stale: true });
    expect(recovered.devices[0]).toMatchObject({ deviceId: first.devices[0]?.deviceId, stale: false });
  });
});
