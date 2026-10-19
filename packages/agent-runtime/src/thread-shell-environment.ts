import type {
  AgentRuntimeContributedEnvEntry,
  AgentRuntimeShellEnvironment,
} from "./types.js";

interface ThreadShellEnvironmentArgs {
  environmentId: string;
  projectId?: string;
  threadStoragePath?: string;
  threadId: string;
}

interface BuildThreadShellEnvironmentArgs extends ThreadShellEnvironmentArgs {
  baseShellEnv: AgentRuntimeShellEnvironment | undefined;
}

export function buildThreadShellEnvironment(
  args: BuildThreadShellEnvironmentArgs,
): Record<string, string> {
  return {
    ...(args.baseShellEnv ?? {}),
    ...(args.projectId ? { BB_PROJECT_ID: args.projectId } : {}),
    ...(args.threadStoragePath
      ? { BB_THREAD_STORAGE: args.threadStoragePath }
      : {}),
    BB_THREAD_ID: args.threadId,
    BB_ENVIRONMENT_ID: args.environmentId,
  };
}

function resolveContributedEnvValue(
  contribution: AgentRuntimeContributedEnvEntry,
  baseShellEnv: AgentRuntimeShellEnvironment | undefined,
): string | null {
  if (typeof contribution.value === "string") return contribution.value;
  const serverUrl = baseShellEnv?.BB_SERVER_URL;
  return serverUrl === undefined
    ? null
    : `${serverUrl}${contribution.value.serverPath}`;
}

export function resolveContributedEnvironment(
  contributedEnv: readonly AgentRuntimeContributedEnvEntry[],
  baseShellEnv: AgentRuntimeShellEnvironment | undefined,
): Record<string, string> {
  const envVars: Record<string, string> = {};
  for (const contribution of contributedEnv) {
    const value = resolveContributedEnvValue(contribution, baseShellEnv);
    if (value !== null) envVars[contribution.name] = value;
  }
  return envVars;
}

export interface ResolvedThreadEnvironmentEntry {
  name: string;
  source:
    | "shell"
    | { plugin: string }
    | { core: "machine-git" | "machine-environment" | "project-environment" };
  value: string | { masked: true };
  reason?: string;
}

export interface DroppedThreadEnvironmentContribution {
  name: string;
  plugin: string;
}

interface ResolveThreadEnvironmentArgs extends ThreadShellEnvironmentArgs {
  baseShellEnv: AgentRuntimeShellEnvironment | undefined;
  contributedEnv: readonly AgentRuntimeContributedEnvEntry[];
}

export function resolveThreadEnvironment(args: ResolveThreadEnvironmentArgs): {
  droppedContributions: DroppedThreadEnvironmentContribution[];
  envVars: Record<string, string>;
  entries: ResolvedThreadEnvironmentEntry[];
} {
  const envVars = buildThreadShellEnvironment(args);
  const droppedContributions: DroppedThreadEnvironmentContribution[] = [];
  const entries: ResolvedThreadEnvironmentEntry[] = Object.entries(envVars).map(
    ([name, value]) => ({ name, source: "shell", value }),
  );
  for (const contribution of args.contributedEnv) {
    const value = resolveContributedEnvValue(contribution, args.baseShellEnv);
    if (value === null) {
      entries.push({
        name: contribution.name,
        source: contribution.source,
        value: { masked: true },
        reason: `${contribution.reason} (dropped: no BB_SERVER_URL)`,
      });
      droppedContributions.push({
        name: contribution.name,
        plugin:
          "plugin" in contribution.source
            ? contribution.source.plugin
            : contribution.source.core,
      });
      continue;
    }
    envVars[contribution.name] = value;
    const existingIndex = entries.findIndex(
      (entry) => entry.name === contribution.name,
    );
    if (existingIndex !== -1) entries.splice(existingIndex, 1);
    entries.push({
      name: contribution.name,
      source: contribution.source,
      value: "core" in contribution.source ? { masked: true } : value,
      reason: contribution.reason,
    });
  }
  return { droppedContributions, envVars, entries };
}
