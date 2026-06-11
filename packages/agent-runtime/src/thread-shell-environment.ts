import type {
  AgentRuntimeSessionKind,
  AgentRuntimeShellEnvironment,
} from "./types.js";

interface BuildThreadShellEnvironmentArgs {
  baseShellEnv: AgentRuntimeShellEnvironment | undefined;
  environmentId: string;
  projectId?: string;
  sessionKind: AgentRuntimeSessionKind;
  threadStoragePath?: string;
  threadId: string;
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
    // Workflow agent sessions stay unaddressable as bb threads: without
    // BB_THREAD_ID their synthetic ids never leak into thr_* surfaces.
    ...(args.sessionKind === "thread" ? { BB_THREAD_ID: args.threadId } : {}),
    BB_ENVIRONMENT_ID: args.environmentId,
  };
}
