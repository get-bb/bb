import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { MIGRATIONS } from "../../../lib/store/schema.js";
import { detectProbeRs, detectSerialPorts, enumerateDevices } from "./enumerate.js";
import type { FamilyAdapter, FamilyDescriptor } from "./families.js";

const databases: Database.Database[] = [];
const directories: string[] = [];
const originalPath = process.env.PATH;

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
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  process.env.PATH = originalPath;
});

function fixtureBinary(directory: string, name: string, output: string): void {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\nprintf '%b\\n' ${JSON.stringify(output)}\n`, "utf8");
  chmodSync(path, 0o755);
}

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
  it("parses live probe-rs and pyserial command output without phantom devices", async () => {
    const directory = mkdtempSync(join(tmpdir(), "fs123-detectors-"));
    directories.push(directory);
    fixtureBinary(directory, "probe-rs", [
      "The following debug probes were found:",
      "[7]: Debug Probe _CMSIS_DAP_ -- 2e8a:000c:E663AC91D351832E (CMSIS-DAP)",
      "this malformed line must not discard valid probes",
      "[2]: J-Link (J-Link) (VID: 1366, PID: 0101, Serial: 000099999999, JLink)",
    ].join("\n"));
    fixtureBinary(directory, "python3", JSON.stringify([
      { device: "/dev/ttyACM0", serialNumber: "SERIAL-A", manufacturer: "Acme", product: "UART" },
      { malformed: true },
      { device: "/dev/ttyUSB0", serialNumber: null, manufacturer: null, product: "Bridge" },
    ]));
    process.env.PATH = `${directory}:${originalPath ?? ""}`;

    const probes = await detectProbeRs();
    expect(probes).toEqual([
      expect.objectContaining({
        stableIdentity: "E663AC91D351832E",
        connection: "usb:2e8a:000c:E663AC91D351832E",
        model: "Debug Probe _CMSIS_DAP_",
      }),
      expect.objectContaining({
        stableIdentity: "000099999999",
        connection: "usb:1366:0101:000099999999",
        model: "J-Link (J-Link)",
      }),
    ]);
    fixtureBinary(
      directory,
      "probe-rs",
      "The following debug probes were found:\n[0]: J-Link (J-Link) (VID: 1366, PID: 0101, Serial: 000099999999, JLink)",
    );
    await expect(detectProbeRs()).resolves.toEqual([
      expect.objectContaining({ stableIdentity: probes[1]?.stableIdentity }),
    ]);
    await expect(detectSerialPorts()).resolves.toEqual([
      expect.objectContaining({ stableIdentity: "SERIAL-A", connection: "tty:/dev/ttyACM0" }),
      expect.objectContaining({ stableIdentity: "/dev/ttyUSB0", connection: "tty:/dev/ttyUSB0" }),
    ]);
  });

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
          }, {
            stableIdentity: "",
            make: null,
            model: "Malformed",
            connection: "not-a-connection",
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
    expect(result).toMatchObject({ totalDevices: 1, truncated: false });
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

  it("discloses when the bounded enumeration return is truncated", async () => {
    const db = createConnection(":memory:");
    migrate(db);
    const adapter: FamilyAdapter = {
      descriptor: descriptor("serial", "serial"),
      async enumerate() {
        return Array.from({ length: 201 }, (_, index) => ({
          stableIdentity: `serial-${index}`,
          make: null,
          model: "UART",
          connection: `tty:/dev/test-${index}`,
          transport: "local-usb" as const,
        }));
      },
    };
    const result = await enumerateDevices({
      db,
      projectId: "project-1",
      projectVersionId: null,
      families: [adapter],
      helperProbe: async () => ({ available: true, reason: null }),
    });
    expect(result).toMatchObject({ totalDevices: 201, truncated: true });
    expect(result.devices).toHaveLength(200);
  });
});
