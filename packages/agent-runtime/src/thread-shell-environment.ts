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

export interface ResolvedThreadEnvironmentEntry {
  name: string;
  source: "shell" | { plugin: string };
  value: string | { masked: true };
  reason?: string;
}

interface ResolveThreadEnvironmentArgs extends ThreadShellEnvironmentArgs {
  baseShellEnv: AgentRuntimeShellEnvironment | undefined;
  contributedEnv: readonly AgentRuntimeContributedEnvEntry[];
}

export function resolveThreadEnvironment(args: ResolveThreadEnvironmentArgs): {
  envVars: Record<string, string>;
  entries: ResolvedThreadEnvironmentEntry[];
} {
  const envVars = buildThreadShellEnvironment(args);
  const entries: ResolvedThreadEnvironmentEntry[] = Object.entries(envVars).map(
    ([name, value]) => ({ name, source: "shell", value }),
  );
  for (const contribution of args.contributedEnv) {
    let value: string;
    if (typeof contribution.value === "string") {
      value = contribution.value;
    } else {
      const serverUrl = args.baseShellEnv?.BB_SERVER_URL;
      if (serverUrl === undefined) {
        throw new Error(
          `Cannot resolve serverPath environment contribution ${contribution.name} without BB_SERVER_URL`,
        );
      }
      value = `${serverUrl}${contribution.value.serverPath}`;
    }
    envVars[contribution.name] = value;
    const existingIndex = entries.findIndex(
      (entry) => entry.name === contribution.name,
    );
    if (existingIndex !== -1) entries.splice(existingIndex, 1);
    entries.push({
      name: contribution.name,
      source: contribution.source,
      value: contribution.secret ? { masked: true } : value,
      reason: contribution.reason,
    });
  }
  return { envVars, entries };
}
