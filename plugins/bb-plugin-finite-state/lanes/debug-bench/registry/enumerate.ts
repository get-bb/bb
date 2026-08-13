import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type Database from "better-sqlite3";
import {
  FAMILY_DESCRIPTORS,
  type BenchDeviceRecord,
  type DeviceCandidate,
  type DeviceTransport,
  type FamilyAdapter,
  type FamilyDescriptor,
  type FamilyStatus,
} from "./families.js";
import { probeHelper, type HelperProbe } from "./helpers.js";
import {
  initializeRegistryStore,
  listDevices,
  listFamilyStatuses,
  recordFamilyStatus,
  upsertCandidate,
  type RegistryScope,
} from "./store.js";

const execFileAsync = promisify(execFile);
const CONNECTION_PREFIXES = ["usb:", "lan:", "tty:"] as const;

export interface BenchContext extends RegistryScope {
  db: Database.Database;
  families?: readonly FamilyAdapter[];
  helperProbe?: HelperProbe;
  now?: () => Date;
  log?: { warn(message: string): void };
}

export interface EnumerationResult {
  families: FamilyStatus[];
  devices: BenchDeviceRecord[];
  totalDevices: number;
  truncated: boolean;
}

function messageFrom(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message.slice(0, 1000)
    : "Unknown detection failure";
}

function connectionMatchesTransport(
  connection: string,
  transport: DeviceTransport,
): boolean {
  if (!CONNECTION_PREFIXES.some((prefix) => connection.startsWith(prefix))) return false;
  if (transport === "local-usb") {
    return connection.startsWith("usb:") || connection.startsWith("tty:");
  }
  if (transport === "local-net") return connection.startsWith("lan:");
  return true;
}

function validateCandidates(
  family: FamilyDescriptor,
  candidates: readonly DeviceCandidate[],
): readonly DeviceCandidate[] {
  const identities = new Set<string>();
  const valid: DeviceCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.stableIdentity.trim().length === 0) continue;
    if (!family.transports.includes(candidate.transport)) continue;
    if (!connectionMatchesTransport(candidate.connection, candidate.transport)) continue;
    const normalized = candidate.stableIdentity.trim().toLocaleLowerCase("en-US");
    if (identities.has(normalized)) continue;
    identities.add(normalized);
    valid.push(candidate);
  }
  return valid;
}

function helperSummary(descriptor: FamilyDescriptor): FamilyStatus["helper"] {
  return {
    id: descriptor.helper.id,
    displayName: descriptor.helper.displayName,
    source: descriptor.helper.source,
    why: descriptor.helper.why,
  };
}

interface ProbeRsLine {
  description: string;
  vid: string;
  pid: string;
  serialNumber: string;
  probeType: string;
}

function probeRsLine(line: string): ProbeRsLine | null {
  const legacy = /^\[\d+\]:\s*(.+?)\s+--\s+([0-9a-f]{4}):([0-9a-f]{4}):([^\s]*)\s+\(([^)]+)\)$/iu.exec(line);
  if (legacy) {
    return {
      description: legacy[1]!,
      vid: legacy[2]!.toLocaleLowerCase("en-US"),
      pid: legacy[3]!.toLocaleLowerCase("en-US"),
      serialNumber: legacy[4]!,
      probeType: legacy[5]!,
    };
  }
  const current = /^\[\d+\]:\s*(.+?)\s+\(VID:\s*([0-9a-f]{4}),\s*PID:\s*([0-9a-f]{4}),\s*Serial:\s*(.*?),\s*([^)]+)\)$/iu.exec(line);
  if (!current) return null;
  return {
    description: current[1]!,
    vid: current[2]!.toLocaleLowerCase("en-US"),
    pid: current[3]!.toLocaleLowerCase("en-US"),
    serialNumber: current[4]!,
    probeType: current[5]!,
  };
}

export async function detectProbeRs(): Promise<readonly DeviceCandidate[]> {
  const result = await execFileAsync("probe-rs", ["list"], {
    timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
  return result.stdout.split(/\r?\n/u)
    .map((line) => line.trim())
    .map(probeRsLine)
    .filter((probe): probe is ProbeRsLine => probe !== null)
    .map((probe) => {
      const connection = `usb:${probe.vid}:${probe.pid}:${probe.serialNumber.trim()}`;
      return {
        stableIdentity: probe.serialNumber.trim() || connection,
        make: probe.probeType,
        model: probe.description,
        connection,
        transport: "local-usb" as const,
      };
    });
}

interface SerialPortJson {
  device: string;
  serialNumber: string | null;
  manufacturer: string | null;
  product: string | null;
}

function serialPort(value: unknown): SerialPortJson | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const device = Reflect.get(value, "device");
  const serialNumber = Reflect.get(value, "serialNumber");
  const manufacturer = Reflect.get(value, "manufacturer");
  const product = Reflect.get(value, "product");
  if (typeof device !== "string") return null;
  if (serialNumber !== null && typeof serialNumber !== "string") return null;
  if (manufacturer !== null && typeof manufacturer !== "string") return null;
  if (product !== null && typeof product !== "string") return null;
  return { device, serialNumber, manufacturer, product };
}

export async function detectSerialPorts(): Promise<readonly DeviceCandidate[]> {
  const script = [
    "import json, serial.tools.list_ports",
    "print(json.dumps([{'device': p.device, 'serialNumber': p.serial_number, 'manufacturer': p.manufacturer, 'product': p.product} for p in serial.tools.list_ports.comports()]))",
  ].join("; ");
  const result = await execFileAsync("python3", ["-c", script], {
    timeout: 10_000,
    maxBuffer: 256 * 1024,
  });
  const parsed: unknown = JSON.parse(result.stdout);
  if (!Array.isArray(parsed)) throw new Error("pyserial returned a non-array result.");
  return parsed.map(serialPort).filter((port): port is SerialPortJson => port !== null)
    .map((port) => ({
      stableIdentity: port.serialNumber ?? port.device,
      make: port.manufacturer,
      model: port.product,
      connection: `tty:${port.device}`,
      transport: "local-usb" as const,
    }));
}

function passiveAdapter(descriptor: FamilyDescriptor): FamilyAdapter {
  return {
    descriptor,
    async enumerate() {
      // Driver WPs replace helper-readiness with vendor discovery. Until then,
      // an installed helper and no candidates is the only truthful result in CI.
      return [];
    },
  };
}

export function createDefaultFamilyAdapters(): readonly FamilyAdapter[] {
  return FAMILY_DESCRIPTORS.map((descriptor) => {
    if (descriptor.id === "probe-rs") return { descriptor, enumerate: detectProbeRs };
    if (descriptor.id === "serial-ports") return { descriptor, enumerate: detectSerialPorts };
    return passiveAdapter(descriptor);
  });
}

interface FamilyDetection {
  status: FamilyStatus;
  candidates: readonly DeviceCandidate[];
}

async function detectFamily(
  adapter: FamilyAdapter,
  helperCheck: HelperProbe,
  checkedAt: string,
): Promise<FamilyDetection> {
  const descriptor = adapter.descriptor;
  const helper = await helperCheck(descriptor.helper);
  if (!helper.available) {
    return {
      status: {
        familyId: descriptor.id,
        kind: descriptor.kind,
        label: descriptor.label,
        availability: "unavailable",
        reason: helper.reason ?? `${descriptor.helper.displayName} is unavailable.`,
        helper: helperSummary(descriptor),
        needsConfiguration: true,
        checkedAt,
      },
      candidates: [],
    };
  }
  try {
    return {
      status: {
        familyId: descriptor.id,
        kind: descriptor.kind,
        label: descriptor.label,
        availability: "available",
        reason: null,
        helper: helperSummary(descriptor),
        needsConfiguration: false,
        checkedAt,
      },
      candidates: validateCandidates(descriptor, await adapter.enumerate()),
    };
  } catch (error) {
    return {
      status: {
        familyId: descriptor.id,
        kind: descriptor.kind,
        label: descriptor.label,
        availability: "unavailable",
        reason: `Detection failed: ${messageFrom(error)}`,
        helper: helperSummary(descriptor),
        needsConfiguration: false,
        checkedAt,
      },
      candidates: [],
    };
  }
}

export async function enumerateDevices(ctx: BenchContext): Promise<EnumerationResult> {
  initializeRegistryStore(ctx.db);
  const checkedAt = (ctx.now?.() ?? new Date()).toISOString();
  const adapters = ctx.families ?? createDefaultFamilyAdapters();
  const helperCheck = ctx.helperProbe ?? probeHelper;
  const detections = await Promise.all(
    adapters.map(async (adapter) => {
      try {
        return await detectFamily(adapter, helperCheck, checkedAt);
      } catch (error) {
        ctx.log?.warn(
          `Debug-bench family ${adapter.descriptor.id} helper check failed: ${messageFrom(error)}`,
        );
        return {
          status: {
            familyId: adapter.descriptor.id,
            kind: adapter.descriptor.kind,
            label: adapter.descriptor.label,
            availability: "unavailable" as const,
            reason: `Helper check failed: ${messageFrom(error)}`,
            helper: helperSummary(adapter.descriptor),
            needsConfiguration: true,
            checkedAt,
          },
          candidates: [],
        };
      }
    }),
  );

  ctx.db.transaction(() => {
    for (const detection of detections) {
      for (const candidate of detection.candidates) {
        upsertCandidate(
          ctx.db,
          ctx,
          detection.status.familyId,
          detection.status.kind,
          candidate,
          checkedAt,
        );
      }
      recordFamilyStatus(ctx.db, ctx, detection.status);
    }
  }).immediate();

  const devicePage = listDevices(ctx.db, {
    ...ctx,
    pageSize: 200,
    includeStale: true,
  });
  return {
    families: listFamilyStatuses(ctx.db, ctx),
    devices: devicePage.items,
    totalDevices: devicePage.total,
    truncated: devicePage.total > devicePage.items.length,
  };
}
