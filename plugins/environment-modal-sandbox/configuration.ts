export const SETTING_DESCRIPTORS = {
  tokenId: {
    type: "string",
    secret: true,
    label: "Modal token id",
    description:
      "The token id half of a Modal API token (modal token new writes one to ~/.modal.toml).",
  },
  tokenSecret: {
    type: "string",
    label: "Modal token secret",
    secret: true,
    description: "The token secret half of the same Modal API token.",
  },
  appName: {
    type: "string",
    label: "Modal app name",
    description: "The Modal app the sandboxes are created in.",
    default: "bb-sandboxes",
  },
  timeoutMinutes: {
    type: "string",
    label: "Sandbox lifetime (minutes)",
    description:
      "Modal terminates the sandbox after this long. Between 1 and 1440.",
    default: "1440",
  },
  idleMinutes: {
    type: "string",
    label: "Hibernate after idle (minutes)",
    description:
      "Snapshot and stop an idle sandbox after this long. Use 0 to keep it running until Modal's lifetime limit.",
    default: "15",
  },
  cpu: {
    type: "string",
    label: "CPU cores",
    description:
      "Reserved physical cores, fractional allowed. Blank for Modal's default.",
    default: "",
  },
  memoryMiB: {
    type: "string",
    label: "Memory (MiB)",
    description: "Reserved memory in MiB. Blank for Modal's default.",
    default: "",
  },
} as const;

export interface ResolvedSettings {
  tokenId: string;
  tokenSecret: string;
  appName: string;
  environmentVariables: Readonly<Record<string, string>>;
  timeoutMs: number;
  idleMs: number | null;
  cpu: number | null;
  memoryMiB: number | null;
}

export type SettingsResolution =
  | { ok: true; settings: ResolvedSettings }
  | { ok: false; message: string };

export interface RawSettings {
  tokenId: string | undefined;
  tokenSecret: string | undefined;
  appName: string;
  timeoutMinutes: string;
  idleMinutes: string;
  cpu: string;
  memoryMiB: string;
}

const MAX_TIMEOUT_MINUTES = 24 * 60;
const MAX_IDLE_MINUTES = 24 * 60;
function parseNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

export function resolveSettings(raw: RawSettings): SettingsResolution {
  const tokenId = (raw.tokenId ?? "").trim();
  const tokenSecret = (raw.tokenSecret ?? "").trim();
  const missing: string[] = [];
  if (tokenId.length === 0) missing.push("tokenId");
  if (tokenSecret.length === 0) missing.push("tokenSecret");
  if (missing.length > 0) {
    return {
      ok: false,
      message: `Modal sandbox is not configured: set ${missing.join(", ")} in the plugin's settings.`,
    };
  }
  const appName = raw.appName.trim();
  if (appName.length === 0) {
    return { ok: false, message: "Modal sandbox appName must not be blank." };
  }
  const timeoutMinutes = Number(raw.timeoutMinutes.trim());
  if (
    !Number.isInteger(timeoutMinutes) ||
    timeoutMinutes < 1 ||
    timeoutMinutes > MAX_TIMEOUT_MINUTES
  ) {
    return {
      ok: false,
      message: `Modal sandbox timeoutMinutes must be a whole number between 1 and ${MAX_TIMEOUT_MINUTES}, not ${raw.timeoutMinutes}.`,
    };
  }
  const cpu = parseNumber(raw.cpu);
  if (cpu !== null && Number.isNaN(cpu)) {
    return {
      ok: false,
      message: `Modal sandbox cpu must be a positive number or blank, not ${raw.cpu}.`,
    };
  }
  const memoryMiB = parseNumber(raw.memoryMiB);
  if (memoryMiB !== null && Number.isNaN(memoryMiB)) {
    return {
      ok: false,
      message: `Modal sandbox memoryMiB must be a positive number or blank, not ${raw.memoryMiB}.`,
    };
  }
  const idleMinutes = Number(raw.idleMinutes.trim());
  if (
    !Number.isInteger(idleMinutes) ||
    idleMinutes < 0 ||
    idleMinutes > MAX_IDLE_MINUTES
  ) {
    return {
      ok: false,
      message: `Modal sandbox idleMinutes must be a whole number between 0 and ${MAX_IDLE_MINUTES}, not ${raw.idleMinutes}.`,
    };
  }
  return {
    ok: true,
    settings: {
      tokenId,
      tokenSecret,
      appName,
      environmentVariables: {},
      timeoutMs: timeoutMinutes * 60_000,
      idleMs: idleMinutes === 0 ? null : idleMinutes * 60_000,
      cpu,
      memoryMiB,
    },
  };
}
