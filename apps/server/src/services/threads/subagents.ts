import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  buildExecutionOptions,
  prepareTurnSubmitCommandPayload,
} from "./thread-commands.js";
import { requireConnectedHostSession } from "../lib/entity-lookup.js";
import { requireThreadCommandEnvironment } from "./thread-command-environment.js";
import {
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
} from "../hosts/live-command.js";

type Thread = Parameters<typeof prepareTurnSubmitCommandPayload>[1]["thread"];

let nextSubagentRequestId = 0;
function nextRequestId() {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextSubagentRequestId,
  });
  nextSubagentRequestId += 1;
  return requestId;
}

async function prepareSubagentRuntimeCommand(deps: AppDeps, thread: Thread) {
  const environment = await requireThreadCommandEnvironment(deps, { thread });
  requireConnectedHostSession(deps, environment.hostId);
  const execution = await buildExecutionOptions(
    deps,
    {},
    { threadId: thread.id },
  );
  const prepared = await prepareTurnSubmitCommandPayload(deps, {
    environment,
    execution,
    input: [],
    permissionEscalation: "deny",
    target: { mode: "auto", expectedTurnId: null },
    thread,
  });
  return { environment, prepared };
}

export async function listThreadSubagents(deps: AppDeps, thread: Thread) {
  const { environment, prepared } = await prepareSubagentRuntimeCommand(
    deps,
    thread,
  );
  const result = await runLiveHostCommand(deps, {
    command: {
      type: "subagent.list",
      environmentId: environment.id,
      threadId: thread.id,
      options: prepared.options,
      bridgeLaunch: prepared.bridgeLaunch,
      resumeContext: prepared.resumeContext,
    },
    hostId: environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  });
  return result.subagents;
}

export async function tellThreadSubagent(
  deps: AppDeps,
  thread: Thread,
  args: { childRef: string; text: string },
) {
  const { environment, prepared } = await prepareSubagentRuntimeCommand(
    deps,
    thread,
  );
  return runLiveHostCommand(deps, {
    command: {
      type: "subagent.tell",
      environmentId: environment.id,
      threadId: thread.id,
      childRef: args.childRef,
      text: args.text,
      requestId: nextRequestId(),
      options: prepared.options,
      bridgeLaunch: prepared.bridgeLaunch,
      resumeContext: prepared.resumeContext,
    },
    hostId: environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  });
}

export async function cancelThreadSubagent(
  deps: AppDeps,
  thread: Thread,
  childRef: string,
) {
  const { environment, prepared } = await prepareSubagentRuntimeCommand(
    deps,
    thread,
  );
  return runLiveHostCommand(deps, {
    command: {
      type: "subagent.cancel",
      environmentId: environment.id,
      threadId: thread.id,
      childRef,
      requestId: nextRequestId(),
      options: prepared.options,
      bridgeLaunch: prepared.bridgeLaunch,
      resumeContext: prepared.resumeContext,
    },
    hostId: environment.hostId,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  });
}
