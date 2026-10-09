import { z } from "zod";
import { formatCustomAcpProviderId } from "./agents.js";
import { registryAgentIcon } from "./registry-icons.js";

export const ACP_REGISTRY_URL =
  "https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json";

const REGISTRY_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/u;
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const MAX_REGISTRY_AGENTS = 1000;

const packageDistributionSchema = z
  .object({
    package: z.string().min(1),
    args: z.array(z.string()).optional(),
    env: z.record(z.string().regex(ENV_NAME_PATTERN), z.string()).optional(),
  })
  .passthrough();

const optionalText = z
  .string()
  .optional()
  .transform((value) => (value === undefined || value === "" ? null : value));

const registryAgentSchema = z
  .object({
    id: z.string().regex(REGISTRY_ID_PATTERN),
    name: z.string().min(1),
    version: z.string().min(1),
    description: z.string().optional(),
    repository: optionalText,
    website: optionalText,
    authors: z.array(z.string()).optional(),
    license: optionalText,
    distribution: z
      .object({
        npx: packageDistributionSchema.optional(),
        uvx: packageDistributionSchema.optional(),
        binary: z.record(z.string(), z.unknown()).optional(),
      })
      .passthrough(),
  })
  .passthrough();

const registrySchema = z.object({ agents: z.array(z.unknown()) }).passthrough();

export interface AcpRegistryLaunch {
  kind: "npx" | "uvx";
  package: string;
  args: string[];
  env: Record<string, string>;
}

export interface AcpRegistryAgent {
  id: string;
  name: string;
  version: string;
  description: string;
  repository: string | null;
  website: string | null;
  authors: string[];
  license: string | null;
  launch: AcpRegistryLaunch | null;
  binaryPlatforms: string[];
}

export interface AcpRegistryCustomEntry {
  id: string;
  displayName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export function parseAcpRegistry(value: unknown): {
  agents: AcpRegistryAgent[];
  skipped: number;
} {
  const registry = registrySchema.safeParse(value);
  if (!registry.success) {
    throw new Error("The ACP registry response is not a registry document.");
  }
  const agents: AcpRegistryAgent[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const entry of registry.data.agents.slice(0, MAX_REGISTRY_AGENTS)) {
    const parsed = registryAgentSchema.safeParse(entry);
    if (!parsed.success || seen.has(parsed.data.id)) {
      skipped += 1;
      continue;
    }
    seen.add(parsed.data.id);
    const { npx, uvx, binary } = parsed.data.distribution;
    const packaged =
      npx !== undefined
        ? ({ kind: "npx", source: npx } as const)
        : uvx !== undefined
          ? ({ kind: "uvx", source: uvx } as const)
          : null;
    agents.push({
      id: parsed.data.id,
      name: parsed.data.name,
      version: parsed.data.version,
      description: parsed.data.description ?? "",
      repository: parsed.data.repository,
      website: parsed.data.website,
      authors: parsed.data.authors ?? [],
      license: parsed.data.license,
      launch:
        packaged === null
          ? null
          : {
              kind: packaged.kind,
              package: packaged.source.package,
              args: [...(packaged.source.args ?? [])],
              env: { ...packaged.source.env },
            },
      binaryPlatforms: Object.keys(binary ?? {}).sort(),
    });
  }
  return { agents, skipped };
}

export function registryAgentCustomEntry(
  agent: AcpRegistryAgent,
): AcpRegistryCustomEntry | null {
  if (agent.launch === null) {
    return null;
  }
  return {
    id: agent.id,
    displayName: agent.name,
    command: agent.launch.kind,
    args:
      agent.launch.kind === "npx"
        ? ["-y", agent.launch.package, ...agent.launch.args]
        : [agent.launch.package, ...agent.launch.args],
    env: { ...agent.launch.env },
  };
}

function packageNameOf(spec: string): string {
  const versionSeparator = spec.lastIndexOf("@");
  return versionSeparator > 0 ? spec.slice(0, versionSeparator) : spec;
}

function configuredPackageSpec(entry: {
  command?: unknown;
  args?: unknown;
}): string | null {
  if (!Array.isArray(entry.args)) {
    return null;
  }
  const args = entry.args.filter(
    (arg): arg is string => typeof arg === "string",
  );
  if (entry.command === "npx") {
    return args.find((arg) => !arg.startsWith("-")) ?? null;
  }
  return entry.command === "uvx" ? (args[0] ?? null) : null;
}

export type AcpRegistryAgentStatus =
  | "available"
  | "added"
  | "update-available"
  | "built-in"
  | "manual-install";

export interface AcpRegistryAgentView extends AcpRegistryAgent {
  providerId: string;
  status: AcpRegistryAgentStatus;
  command: string | null;
  icon: string | null;
}

function parseSettingEntries(settingValue: string): unknown[] {
  const trimmed = settingValue.trim();
  if (trimmed === "") {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(
      "The custom agents setting is not valid JSON. Fix it in settings before changing agents here.",
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "The custom agents setting must be a JSON array. Fix it in settings before changing agents here.",
    );
  }
  return parsed;
}

function entryId(entry: unknown): string | null {
  if (typeof entry !== "object" || entry === null) {
    return null;
  }
  const id: unknown = Reflect.get(entry, "id");
  return typeof id === "string" ? id : null;
}

function readSettingEntriesLeniently(settingValue: string): unknown[] {
  try {
    return parseSettingEntries(settingValue);
  } catch {
    return [];
  }
}

export function describeRegistryAgents(args: {
  agents: readonly AcpRegistryAgent[];
  settingValue: string;
  reservedProviderIds: ReadonlySet<string>;
}): AcpRegistryAgentView[] {
  const configuredById = new Map<string, object>();
  for (const entry of readSettingEntriesLeniently(args.settingValue)) {
    const id = entryId(entry);
    if (id !== null && typeof entry === "object" && entry !== null) {
      configuredById.set(id, entry);
    }
  }
  return args.agents.map((agent) => {
    const providerId = formatCustomAcpProviderId(agent.id);
    const custom = registryAgentCustomEntry(agent);
    const command =
      custom === null ? null : [custom.command, ...custom.args].join(" ");
    const configured = configuredById.get(agent.id);
    let status: AcpRegistryAgentStatus;
    if (args.reservedProviderIds.has(providerId)) {
      status = "built-in";
    } else if (configured !== undefined) {
      const configuredSpec = configuredPackageSpec(configured);
      status =
        agent.launch !== null &&
        configuredSpec !== null &&
        configuredSpec !== agent.launch.package &&
        packageNameOf(configuredSpec) === packageNameOf(agent.launch.package)
          ? "update-available"
          : "added";
    } else {
      status = custom === null ? "manual-install" : "available";
    }
    return {
      ...agent,
      providerId,
      status,
      command,
      icon: registryAgentIcon(agent.id) ?? null,
    };
  });
}

export function settingWithRegistryAgent(
  settingValue: string,
  agent: AcpRegistryAgent,
): string {
  const custom = registryAgentCustomEntry(agent);
  if (custom === null) {
    throw new Error(
      `${agent.name} is distributed only as a downloadable binary. Install it yourself, then add it as a custom agent with its command.`,
    );
  }
  const entries = parseSettingEntries(settingValue);
  const index = entries.findIndex((entry) => entryId(entry) === agent.id);
  if (index === -1) {
    return JSON.stringify([...entries, custom], null, 2);
  }
  const existing = entries[index];
  const merged =
    typeof existing === "object" && existing !== null
      ? {
          ...existing,
          command: custom.command,
          args: custom.args,
          env: { ...readEnv(existing), ...custom.env },
        }
      : custom;
  return JSON.stringify(
    entries.map((entry, entryIndex) => (entryIndex === index ? merged : entry)),
    null,
    2,
  );
}

function readEnv(entry: object): Record<string, string> {
  const env: unknown = Reflect.get(entry, "env");
  if (typeof env !== "object" || env === null || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(env).filter(
      (pair): pair is [string, string] => typeof pair[1] === "string",
    ),
  );
}

export function settingWithoutAgent(settingValue: string, id: string): string {
  const entries = parseSettingEntries(settingValue);
  const remaining = entries.filter((entry) => entryId(entry) !== id);
  if (remaining.length === entries.length) {
    throw new Error(`No configured agent has the id "${id}".`);
  }
  return remaining.length === 0 ? "" : JSON.stringify(remaining, null, 2);
}
