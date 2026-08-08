import type {
  HostDaemonCommand,
  HostDaemonSettledCommandType,
} from "@bb/host-daemon-contract";
import {
  emptyCommandResultSideEffects,
  type CommandResultReportForType,
  type CommandResultSettlementDeps,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandExecutionRecord,
} from "./command-result-side-effects.js";
import { settleEnvironmentDestroyCommandResult } from "../services/environments/environment-cleanup-internal.js";
import {
  settleEnvironmentProvisionCancelCommandResult,
  settleEnvironmentProvisionCommandResult,
} from "../services/environments/environment-provisioning-internal.js";
import {
  settleThreadPlanCancelCommandResult,
  settleThreadStartCommandResult,
  settleThreadStopCommandResult,
  settleTurnSubmitCommandResult,
} from "../services/threads/thread-lifecycle.js";
import { notifyWorkspaceMutationResult } from "./environment-changes.js";

type ParsedCommandType = HostDaemonSettledCommandType;
type ParsedCommandForType<TType extends ParsedCommandType> = Extract<
  HostDaemonCommand,
  { type: TType }
>;

interface ApplyCommandResultSideEffectsArgs<TType extends ParsedCommandType> {
  command: ParsedCommandForType<TType>;
  deps: CommandResultSettlementDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: CommandResultReportForType<TType>;
}

interface CommandResultOwner<TType extends ParsedCommandType> {
  applySideEffects?(
    args: ApplyCommandResultSideEffectsArgs<TType>,
  ): CommandResultSideEffectsResult | void;
}

type CommandResultOwnerRegistry = {
  [TType in ParsedCommandType]?: CommandResultOwner<TType>;
};

/** Workspace mutations that should notify clients of work-status changes. */
type WorkspaceMutationCommandType =
  | "workspace.commit"
  | "workspace.push"
  | "workspace.squash_merge"
  | "workspace.pull_request_action"
  | "workspace.pull_request_create";

function notifyWorkspaceMutationSideEffects(args: {
  deps: Parameters<typeof notifyWorkspaceMutationResult>[0];
  environmentId: string;
  ok: boolean;
}): void {
  notifyWorkspaceMutationResult(args.deps, {
    environmentId: args.environmentId,
    ok: args.ok,
  });
}

// Required mapped type so a new workspace mutation without a notify arm is a
// compile error (the outer registry is Partial and would not catch misses).
const workspaceMutationResultOwners: {
  [TType in WorkspaceMutationCommandType]: CommandResultOwner<TType>;
} = {
  "workspace.commit": {
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationSideEffects({
        deps,
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  },
  "workspace.push": {
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationSideEffects({
        deps,
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  },
  "workspace.squash_merge": {
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationSideEffects({
        deps,
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  },
  "workspace.pull_request_action": {
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationSideEffects({
        deps,
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  },
  "workspace.pull_request_create": {
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationSideEffects({
        deps,
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  },
};

const commandResultOwners: CommandResultOwnerRegistry = {
  "environment.destroy": {
    applySideEffects: settleEnvironmentDestroyCommandResult,
  },
  "environment.provision": {
    applySideEffects: settleEnvironmentProvisionCommandResult,
  },
  "environment.provision.cancel": {
    applySideEffects: settleEnvironmentProvisionCancelCommandResult,
  },
  "interactive.resolve": {
    applySideEffects: ({ deps, command, report }) => {
      deps.pendingInteractions.settleInteractiveResolveCommandResultInTransaction(
        {
          command,
          deps,
          report,
        },
      );
    },
  },
  "thread.start": {
    applySideEffects: settleThreadStartCommandResult,
  },
  "thread.stop": {
    applySideEffects: settleThreadStopCommandResult,
  },
  "thread.plan.cancel": {
    applySideEffects: settleThreadPlanCancelCommandResult,
  },
  "turn.submit": {
    applySideEffects: settleTurnSubmitCommandResult,
  },
  ...workspaceMutationResultOwners,
} satisfies CommandResultOwnerRegistry;

function getCommandResultOwner<TType extends ParsedCommandType>(
  command: ParsedCommandForType<TType>,
): CommandResultOwner<TType> | undefined {
  return commandResultOwners[command.type];
}

export function handleLiveCommandResultSideEffects<
  TType extends ParsedCommandType,
>(
  deps: CommandResultSettlementDeps,
  args: {
    command: ParsedCommandForType<TType>;
    execution: HostDaemonCommandExecutionRecord;
    report: CommandResultReportForType<TType>;
  },
): CommandResultSideEffectsResult {
  const owner = getCommandResultOwner(args.command);
  if (!owner?.applySideEffects) {
    return emptyCommandResultSideEffects();
  }

  return (
    owner.applySideEffects({
      deps,
      report: args.report,
      command: args.command,
      execution: args.execution,
    }) ?? emptyCommandResultSideEffects()
  );
}
