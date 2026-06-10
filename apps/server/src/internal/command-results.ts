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
  settleThreadStartCommandResult,
  settleThreadStopCommandResult,
  settleTurnSubmitCommandResult,
} from "../services/threads/thread-lifecycle.js";
import {
  settleWorkflowCancelCommandResult,
  settleWorkflowStartCommandResult,
} from "../services/workflows/workflow-run-lifecycle.js";
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
  "turn.submit": {
    applySideEffects: settleTurnSubmitCommandResult,
  },
  "workflow.cancel": {
    applySideEffects: settleWorkflowCancelCommandResult,
  },
  "workflow.start": {
    applySideEffects: settleWorkflowStartCommandResult,
  },
  "workspace.commit": {
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationResult(deps, {
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  },
  "workspace.squash_merge": {
    applySideEffects: ({ deps, command, report }) => {
      notifyWorkspaceMutationResult(deps, {
        environmentId: command.environmentId,
        ok: report.ok,
      });
    },
  },
} satisfies CommandResultOwnerRegistry;

function getCommandResultOwner<TType extends ParsedCommandType>(
  command: ParsedCommandForType<TType>,
): CommandResultOwner<TType> | undefined {
  return commandResultOwners[command.type];
}

export function handleLiveCommandResultSideEffects<TType extends ParsedCommandType>(
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
