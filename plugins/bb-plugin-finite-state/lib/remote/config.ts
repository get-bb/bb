export const REMOTE_SETTING_DESCRIPTORS = {
  platformBaseUrl: { type: "string", label: "Platform URL", default: "" },
  platformToken: { type: "string", label: "Platform token", secret: true },
  platformConcurrency: {
    type: "select",
    label: "Platform concurrency",
    options: ["1", "2", "4", "8", "16"] as string[],
    default: "8",
  },
  asBaseUrl: { type: "string", label: "Assurance Studio URL", default: "" },
  asApiKey: {
    type: "string",
    label: "Assurance Studio API key",
    secret: true,
  },
  asConcurrency: {
    type: "select",
    label: "Assurance Studio concurrency",
    options: ["1", "2", "4", "8", "16"] as string[],
    default: "8",
  },
  forgeTransport: {
    type: "select",
    label: "Forge Compute transport",
    options: ["disabled", "stdio", "streamable-http", "sse"] as string[],
    default: "disabled",
  },
  forgeUrl: { type: "string", label: "Forge Compute URL", default: "" },
  forgeCommand: { type: "string", label: "Forge Compute command", default: "" },
  forgeAuthToken: {
    type: "string",
    label: "Forge Compute bearer",
    secret: true,
  },
  forgeConcurrency: {
    type: "select",
    label: "Forge Compute concurrency",
    options: ["1", "2", "4", "8"] as string[],
    default: "4",
  },
} as const;

export interface RemoteSettingValues {
  platformBaseUrl: string;
  platformToken: string | undefined;
  platformConcurrency: string;
  asBaseUrl: string;
  asApiKey: string | undefined;
  asConcurrency: string;
  forgeTransport: string;
  forgeUrl: string;
  forgeCommand: string;
  forgeAuthToken: string | undefined;
  forgeConcurrency: string;
}

export interface RemoteConfig {
  platformBaseUrl: string | null;
  platformToken: string | null;
  asBaseUrl: string | null;
  asApiKey: string | null;
  forgeTransport: "streamable-http" | "sse" | "stdio" | "disabled";
  forgeUrl: string | null;
  forgeCommand: string | null;
  forgeAuthToken: string | null;
  platformConcurrency: number;
  asConcurrency: number;
  forgeConcurrency: number;
}

function optional(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

function concurrency(value: string, allowed: readonly string[], fallback: number): number {
  return allowed.includes(value) ? Number(value) : fallback;
}

function transport(
  value: string,
): RemoteConfig["forgeTransport"] {
  return value === "stdio" || value === "streamable-http" || value === "sse"
    ? value
    : "disabled";
}

export function readRemoteConfig(values: RemoteSettingValues): RemoteConfig {
  return {
    platformBaseUrl: optional(values.platformBaseUrl),
    platformToken: optional(values.platformToken),
    asBaseUrl: optional(values.asBaseUrl),
    asApiKey: optional(values.asApiKey),
    forgeTransport: transport(values.forgeTransport),
    forgeUrl: optional(values.forgeUrl),
    forgeCommand: optional(values.forgeCommand),
    forgeAuthToken: optional(values.forgeAuthToken),
    platformConcurrency: concurrency(
      values.platformConcurrency,
      REMOTE_SETTING_DESCRIPTORS.platformConcurrency.options,
      8,
    ),
    asConcurrency: concurrency(
      values.asConcurrency,
      REMOTE_SETTING_DESCRIPTORS.asConcurrency.options,
      8,
    ),
    forgeConcurrency: concurrency(
      values.forgeConcurrency,
      REMOTE_SETTING_DESCRIPTORS.forgeConcurrency.options,
      4,
    ),
  };
}

export function platformConfigChanged(
  next: RemoteSettingValues,
  prev: RemoteSettingValues,
): boolean {
  return (
    next.platformBaseUrl !== prev.platformBaseUrl ||
    next.platformToken !== prev.platformToken ||
    next.platformConcurrency !== prev.platformConcurrency
  );
}

export function assuranceStudioConfigChanged(
  next: RemoteSettingValues,
  prev: RemoteSettingValues,
): boolean {
  return (
    next.asBaseUrl !== prev.asBaseUrl ||
    next.asApiKey !== prev.asApiKey ||
    next.asConcurrency !== prev.asConcurrency
  );
}

export function forgeConfigChanged(
  next: RemoteSettingValues,
  prev: RemoteSettingValues,
): boolean {
  return (
    next.forgeTransport !== prev.forgeTransport ||
    next.forgeUrl !== prev.forgeUrl ||
    next.forgeCommand !== prev.forgeCommand ||
    next.forgeAuthToken !== prev.forgeAuthToken ||
    next.forgeConcurrency !== prev.forgeConcurrency
  );
}
