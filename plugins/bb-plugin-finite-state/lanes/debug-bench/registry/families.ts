export type DeviceKind = "probe" | "logic" | "power" | "scope" | "serial";
export type DeviceTransport = "local-usb" | "local-net" | "bb-host";
export type ClaimScope = "machine" | "fleet";
export const BENCH_CHANGED_CHANNEL = "benchDev:changed" as const;

export interface BenchDeviceRecord {
  projectId: string;
  projectVersionId: string | null;
  deviceId: string;
  kind: DeviceKind;
  make: string | null;
  model: string | null;
  connection: string;
  transport: DeviceTransport;
  claimedBy: string | null;
  claimedAt: string | null;
  claimScope: ClaimScope;
  lastSeen: string;
  stale: boolean;
}

export interface DeviceCandidate {
  stableIdentity: string;
  make: string | null;
  model: string | null;
  connection: string;
  transport: DeviceTransport;
}

export interface HelperDescriptor {
  id: string;
  displayName: string;
  source: string;
  why: string;
  check: readonly [command: string, ...args: string[]];
  install: readonly [command: string, ...args: string[]];
}

export interface FamilyDescriptor {
  id: string;
  kind: DeviceKind;
  label: string;
  detectionStrategy: string;
  helper: HelperDescriptor;
  transports: readonly DeviceTransport[];
}

export interface FamilyAdapter {
  descriptor: FamilyDescriptor;
  enumerate(): Promise<readonly DeviceCandidate[]>;
}

export interface FamilyStatus {
  familyId: string;
  kind: DeviceKind;
  label: string;
  availability: "available" | "unavailable";
  reason: string | null;
  helper: Pick<HelperDescriptor, "id" | "displayName" | "source" | "why">;
  needsConfiguration: boolean;
  checkedAt: string;
}

const PYTHON_IMPORT = (moduleName: string) =>
  ["python3", "-c", `import ${moduleName}`] as const;

export const FAMILY_DESCRIPTORS = [
  {
    id: "probe-rs",
    kind: "probe",
    label: "Debug probes",
    detectionStrategy: "probe-rs list",
    helper: {
      id: "probe-rs-tools",
      displayName: "probe-rs tools",
      source: "https://probe.rs/docs/getting-started/installation/",
      why: "Enumerates supported CMSIS-DAP, ST-Link, J-Link, and FTDI debug probes.",
      check: ["probe-rs", "--version"],
      install: ["cargo", "install", "probe-rs-tools"],
    },
    transports: ["local-usb", "bb-host"],
  },
  {
    id: "saleae-logic",
    kind: "logic",
    label: "Logic analyzers",
    detectionStrategy: "Saleae Logic 2 automation discovery",
    helper: {
      id: "logic2-automation",
      displayName: "logic2-automation",
      source: "https://pypi.org/project/logic2-automation/",
      why: "Connects to Saleae Logic 2 for non-invasive analyzer discovery.",
      check: PYTHON_IMPORT("saleae.automation"),
      install: ["python3", "-m", "pip", "install", "logic2-automation"],
    },
    transports: ["local-usb", "local-net", "bb-host"],
  },
  {
    id: "nordic-ppk2",
    kind: "power",
    label: "Power analyzers",
    detectionStrategy: "PPK2 API serial discovery",
    helper: {
      id: "ppk2-api",
      displayName: "ppk2-api",
      source: "https://pypi.org/project/ppk2-api/",
      why: "Enumerates Nordic Power Profiler Kit II instruments.",
      check: PYTHON_IMPORT("ppk2_api"),
      install: ["python3", "-m", "pip", "install", "ppk2-api"],
    },
    transports: ["local-usb", "bb-host"],
  },
  {
    id: "digilent-waveforms",
    kind: "scope",
    label: "Oscilloscopes",
    detectionStrategy: "Digilent WaveForms device discovery",
    helper: {
      id: "dwfpy",
      displayName: "dwfpy",
      source: "https://pypi.org/project/dwfpy/",
      why: "Enumerates local Digilent WaveForms scope-capable instruments.",
      check: PYTHON_IMPORT("dwfpy"),
      install: ["python3", "-m", "pip", "install", "dwfpy"],
    },
    transports: ["local-usb", "bb-host"],
  },
  {
    id: "serial-ports",
    kind: "serial",
    label: "Serial ports",
    detectionStrategy: "pyserial list_ports",
    helper: {
      id: "pyserial",
      displayName: "pyserial",
      source: "https://pypi.org/project/pyserial/",
      why: "Enumerates local serial ports without opening or perturbing them.",
      check: PYTHON_IMPORT("serial.tools.list_ports"),
      install: ["python3", "-m", "pip", "install", "pyserial"],
    },
    transports: ["local-usb", "bb-host"],
  },
] as const satisfies readonly FamilyDescriptor[];

export function familyDescriptor(familyId: string): FamilyDescriptor | null {
  return FAMILY_DESCRIPTORS.find((family) => family.id === familyId) ?? null;
}
