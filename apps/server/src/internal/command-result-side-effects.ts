import type { DbNotifier, DbTransaction } from "@bb/db";
import type {
  HostDaemonCommand,
  HostDaemonCommandResult,
  HostDaemonSettledCommandType,
} from "@bb/host-daemon-contract";
import type { InteractiveLifecycleCoordinationDeps } from "../lifecycle-coordination-deps.js";
import type { AppDeps } from "../types.js";

export type CommandResultSideEffectsDeps =
  InteractiveLifecycleCoordinationDeps & Pick<AppDeps, "terminalSessions">;

export type CommandResultSettlementDeps = Omit<
  CommandResultSideEffectsDeps,
  "db" | "hub"
> & {
  db: DbTransaction;
  hub: DbNotifier;
};

export interface HostDaemonCommandExecutionRecord {
  createdAt: number;
  hostId: string;
  id: string;
}

interface LiveHostCommandResultReportBase {
  completedAt: number;
  executionId: string;
}

export type LiveHostCommandSuccessResultReportForType<
  TType extends HostDaemonSettledCommandType,
> = LiveHostCommandResultReportBase & {
  type: TType;
  ok: true;
  result: HostDaemonCommandResult<TType>;
};

export type LiveHostCommandFailureResultReportForType<
  TType extends HostDaemonSettledCommandType,
> = LiveHostCommandResultReportBase & {
  type: TType;
  ok: false;
  errorCode: string;
  errorMessage: string;
};

export type HostDaemonCommandForType<
  TType extends HostDaemonSettledCommandType,
> = Extract<HostDaemonCommand, { type: TType }>;

export type CommandResultReportForType<
  TType extends HostDaemonSettledCommandType,
> =
  | LiveHostCommandSuccessResultReportForType<TType>
  | LiveHostCommandFailureResultReportForType<TType>;

export type CommandResultFailureReportForType<
  TType extends HostDaemonSettledCommandType,
> = Extract<CommandResultReportForType<TType>, { ok: false }>;

interface CommandResultPostCommitActionContext {
  environmentId?: string | null;
  hostId?: string;
  threadId?: string;
}

export interface CommandResultPostCommitAction {
  context?: CommandResultPostCommitActionContext;
  name: string;
  run(deps: CommandResultSideEffectsDeps): Promise<void> | void;
}

export interface CommandResultSideEffectsResult {
  postCommitActions: CommandResultPostCommitAction[];
}

interface BuildCommandResultSettlementDepsArgs {
  db: DbTransaction;
  deps: CommandResultSideEffectsDeps;
  hub: DbNotifier;
}

export function buildCommandResultSettlementDeps(
  args: BuildCommandResultSettlementDepsArgs,
): CommandResultSettlementDeps {
  return {
    ...args.deps,
    db: args.db,
    hub: args.hub,
  };
}

export function emptyCommandResultSideEffects(): CommandResultSideEffectsResult {
  return { postCommitActions: [] };
}
