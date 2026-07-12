import { loadCliConfig, type CliConfig } from "@bb/config/cli";

const VALID_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface CliRuntimeContext {
  cliConfig: CliConfig;
}

export interface CreateCliRuntimeContextArgs {
  cliConfig?: CliConfig;
}

export interface ResolveExplicitIdFlagArgs {
  flagName: string;
  value?: string;
}

export function createCliRuntimeContext(
  args: CreateCliRuntimeContextArgs = {},
): CliRuntimeContext {
  return {
    cliConfig: args.cliConfig ?? loadCliConfig(),
  };
}

function validateId(value: string, source: string): string {
  if (!VALID_ID_PATTERN.test(value)) {
    throw new Error(
      `Invalid ID from ${source}: "${value}". IDs must contain only letters, digits, hyphens, and underscores.`,
    );
  }
  return value;
}

function trimToUndefined(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveServerUrl(
  context: CliRuntimeContext = createCliRuntimeContext(),
): string {
  return context.cliConfig.BB_SERVER_URL;
}

export function resolveContextProjectId(): string | undefined {
  const fromEnv = trimToUndefined(process.env.BB_PROJECT_ID);
  if (fromEnv) return validateId(fromEnv, "BB_PROJECT_ID");
  return undefined;
}

export function resolveContextThreadId(): string | undefined {
  const fromEnv = trimToUndefined(process.env.BB_THREAD_ID);
  if (fromEnv) return validateId(fromEnv, "BB_THREAD_ID");
  return undefined;
}

export function resolveExplicitIdFlag(
  args: ResolveExplicitIdFlagArgs,
): string | undefined {
  const fromFlag = trimToUndefined(args.value);
  if (fromFlag) return validateId(fromFlag, args.flagName);
  return undefined;
}

export function requireProjectId(flagValue?: string): string {
  const projectId = resolveExplicitIdFlag({
    flagName: "--project flag",
    value: flagValue,
  });
  if (projectId) return projectId;
  throw new Error("Missing project ID. Pass --project <id>.");
}

export function requireThreadId(positionalId?: string): string {
  const threadId = resolveExplicitIdFlag({
    flagName: "<threadId> argument",
    value: positionalId,
  });
  if (threadId) return threadId;
  throw new Error("Missing thread ID. Pass <threadId>.");
}

export interface ResolvedId {
  id: string;
  /** "arg" when provided as a positional/flag, "env" when resolved from BB_* env. */
  source: "arg" | "env";
}

export interface ThreadSelfTargetOptions {
  self?: boolean;
}

/**
 * Require a thread ID for commands that support `--self`.
 *
 * - Positional `<id>` and `--self` are mutually exclusive.
 * - `--self` resolves from BB_THREAD_ID.
 * - If neither is provided, error with guidance.
 */
export function requireThreadIdOrSelf(
  positionalId: string | undefined,
  opts: ThreadSelfTargetOptions,
): string {
  if (opts.self && positionalId) {
    throw new Error("Cannot combine a thread ID argument with --self.");
  }
  if (opts.self) {
    const envThreadId = resolveContextThreadId();
    if (!envThreadId) {
      throw new Error("--self requires BB_THREAD_ID to be set.");
    }
    return envThreadId;
  }
  if (positionalId) {
    return validateId(positionalId, "<threadId> argument");
  }
  throw new Error("Missing thread ID. Pass <threadId> or use --self.");
}

export interface ContextSnapshot {
  projectId?: string;
  threadId?: string;
  serverUrl: string;
}

export function resolveContextSnapshot(
  context: CliRuntimeContext = createCliRuntimeContext(),
): ContextSnapshot {
  return {
    projectId: resolveContextProjectId(),
    threadId: resolveContextThreadId(),
    serverUrl: context.cliConfig.BB_SERVER_URL,
  };
}
