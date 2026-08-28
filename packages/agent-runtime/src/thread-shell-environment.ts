import type { AgentRuntimeShellEnvironment } from "./types.js";

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
) {
  const environment: AgentRuntimeShellEnvironment = {
    ...(args.baseShellEnv ?? {}),
    BB_THREAD_ID: args.threadId,
    BB_ENVIRONMENT_ID: args.environmentId,
  };
  if (args.projectId) {
    environment.BB_PROJECT_ID = args.projectId;
  }
  if (args.threadStoragePath) {
    environment.BB_THREAD_STORAGE = args.threadStoragePath;
  }
  return environment;
}
