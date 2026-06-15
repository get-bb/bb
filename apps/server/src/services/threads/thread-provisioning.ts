import { getThread, type DbNotifier, type DbTransaction } from "@bb/db";
import {
  type Environment,
  type PromptInput,
  type ProvisioningTranscriptEntry,
  type ResolvedThreadExecutionOptions,
  type Thread,
  type ThreadTurnInitiator,
  type TurnRequestTarget,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import {
  appendClientTurnEvent,
  buildCwdBranchEntries,
} from "./thread-events.js";
import { requestThreadStart } from "./thread-lifecycle.js";
import { resolvePermissionEscalation } from "./thread-runtime-config.js";
import {
  attachedEnvironmentIdForContext,
  createMetadataPendingContext,
  createReprovisioningContext,
  type ThreadProvisionEnvironmentIntent,
  type ThreadProvisionContext,
  type ThreadProvisionProvisionableContext,
} from "./thread-provisioning-context.js";
import {
  ensureThreadProvisionEnvironmentReady,
  ensureWorkspaceReadyEvent,
  ensureWorkspaceReadyEventInTransaction,
  failThreadProvisioning,
  loadActiveThreadProvisionContext,
  saveThreadProvisionContext,
  type ThreadProvisioningDeps,
} from "./thread-provisioning-environment.js";
import {
  forgetActiveThreadProvisionContext,
  getActiveThreadProvisionContext,
} from "./thread-provisioning-active-context.js";
import { recordAcceptedPromptHistoryEntry } from "../prompt-history.js";

interface RequestThreadProvisionArgs {
  environmentIntent: ThreadProvisionEnvironmentIntent;
  execution: ResolvedThreadExecutionOptions;
  input: PromptInput[];
  thread: Thread;
  titleProvided: boolean;
}

interface RequestThreadReprovisionArgs {
  environment: Environment;
  provisionEventSequence: number;
  execution: ResolvedThreadExecutionOptions;
  input: PromptInput[];
  initiator: ThreadTurnInitiator;
  provisioningId: string;
  senderThreadId: string | null;
  thread: Thread;
}

interface AdvanceThreadProvisioningArgs {
  context?: ThreadProvisionContext;
  threadId: string;
}

interface CurrentProvisioningFailureThreadArgs {
  context: ThreadProvisionContext;
  threadId: string;
}

interface RecordThreadProvisionWorkspaceReadyArgs {
  entries: ProvisioningTranscriptEntry[];
  environmentId: string;
  threadId: string;
}

interface ThreadProvisionWorkspaceReadyTransactionDeps {
  db: DbTransaction;
  hub: DbNotifier;
}

interface EnvironmentPayloadThreadArgs {
  context: ThreadProvisionProvisionableContext;
  environment: Environment;
  thread: Thread;
}

type CurrentProvisioningFailureThreadDeps = Pick<AppDeps, "db">;

function getCurrentProvisioningFailureThread(
  deps: CurrentProvisioningFailureThreadDeps,
  args: CurrentProvisioningFailureThreadArgs,
): Thread | null {
  const currentThread = getThread(deps.db, args.threadId);
  if (!currentThread || currentThread.deletedAt !== null) {
    forgetActiveThreadProvisionContext(args.threadId);
    return null;
  }
  if (
    currentThread.status !== "starting" ||
    currentThread.archivedAt !== null
  ) {
    forgetActiveThreadProvisionContext(args.threadId);
    return null;
  }

  const activeContext = getActiveThreadProvisionContext(args.threadId);
  if (
    activeContext &&
    activeContext.state.provisioningId !== args.context.state.provisioningId
  ) {
    return null;
  }

  return currentThread;
}

async function startThreadIfEnvironmentReady(
  deps: ThreadProvisioningDeps,
  args: EnvironmentPayloadThreadArgs,
): Promise<void> {
  if (args.environment.status === "error") {
    failThreadProvisioning(deps, {
      thread: args.thread,
      environmentId: args.environment.id,
      detail: "Environment provisioning failed",
    });
    return;
  }
  if (args.environment.status === "provisioning") {
    return;
  }
  if (args.environment.status !== "ready") {
    failThreadProvisioning(deps, {
      thread: args.thread,
      environmentId: args.environment.id,
      detail: `Environment is ${args.environment.status}`,
    });
    return;
  }
  if (!args.environment.path) {
    failThreadProvisioning(deps, {
      thread: args.thread,
      environmentId: args.environment.id,
      detail: "Environment is ready without a workspace path",
    });
    return;
  }

  const workspaceReadyEventSequence = ensureWorkspaceReadyEvent(deps, {
    context: args.context,
    threadId: args.thread.id,
    environmentId: args.environment.id,
    entries: buildCwdBranchEntries({
      path: args.environment.path,
      branchName: args.environment.branchName,
    }),
  });
  if (workspaceReadyEventSequence === null) {
    throw new Error("Workspace ready event sequence was not recorded");
  }

  await requestThreadStart(deps, {
    thread: args.thread,
    environment: {
      id: args.environment.id,
      hostId: args.environment.hostId,
      path: args.environment.path,
      status: args.environment.status,
      workspaceProvisionType: args.environment.workspaceProvisionType,
    },
    input: args.context.request.input,
    requestId: args.context.request.clientRequestId,
    execution: args.context.request.execution,
    permissionEscalation: resolvePermissionEscalation({
      thread: args.thread,
      initiator: "user",
    }),
    projectId: args.thread.projectId,
    providerId: args.thread.providerId,
    syncGeneratedTitle: !args.context.request.titleProvided,
  });
}

export function requestThreadProvision(
  deps: Pick<AppDeps, "db" | "hub">,
  args: RequestThreadProvisionArgs,
): ThreadProvisionContext {
  const initiator: ThreadTurnInitiator = "user";
  const target: TurnRequestTarget = { kind: "thread-start" };
  const request = appendClientTurnEvent(deps, {
    threadId: args.thread.id,
    environmentId: args.thread.environmentId,
    type: "client/turn/requested",
    input: args.input,
    execution: args.execution,
    initiator,
    senderThreadId: null,
    requestMethod: "thread/start",
    source: "spawn",
    target,
  });
  recordAcceptedPromptHistoryEntry(deps, {
    thread: args.thread,
    input: args.input,
    initiator,
    target,
    requestSequence: request.sequence,
  });
  appendClientTurnEvent(deps, {
    threadId: args.thread.id,
    environmentId: args.thread.environmentId,
    type: "client/thread/start",
    initiator,
    requestMethod: "thread/start",
    source: "spawn",
  });

  const context = createMetadataPendingContext({
    ...args,
    clientRequestId: request.requestId,
  });
  saveThreadProvisionContext({
    threadId: args.thread.id,
    context,
  });
  return context;
}

export function requestThreadReprovision(
  deps: Pick<AppDeps, "db" | "hub">,
  args: RequestThreadReprovisionArgs,
): ThreadProvisionContext {
  const request = appendClientTurnEvent(deps, {
    threadId: args.thread.id,
    environmentId: args.environment.id,
    type: "client/turn/requested",
    input: args.input,
    execution: args.execution,
    initiator: args.initiator,
    senderThreadId: args.senderThreadId,
    requestMethod: "turn/start",
    source: "tell",
    target: { kind: "new-turn" },
  });
  recordAcceptedPromptHistoryEntry(deps, {
    thread: args.thread,
    input: args.input,
    initiator: args.initiator,
    target: { kind: "new-turn" },
    requestSequence: request.sequence,
  });

  const context = createReprovisioningContext({
    clientRequestId: request.requestId,
    provisionEventSequence: args.provisionEventSequence,
    execution: args.execution,
    environmentId: args.environment.id,
    input: args.input,
    provisioningId: args.provisioningId,
  });
  saveThreadProvisionContext({
    threadId: args.thread.id,
    context,
  });
  return context;
}

export function recordThreadProvisionWorkspaceReadyInTransaction(
  deps: ThreadProvisionWorkspaceReadyTransactionDeps,
  args: RecordThreadProvisionWorkspaceReadyArgs,
): void {
  ensureWorkspaceReadyEventInTransaction(deps, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    entries: args.entries,
  });
}

async function advanceThreadProvisioningOnce(
  deps: ThreadProvisioningDeps,
  args: AdvanceThreadProvisioningArgs,
): Promise<void> {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.deletedAt !== null) {
    return;
  }
  if (thread.status !== "starting") {
    forgetActiveThreadProvisionContext(thread.id);
    return;
  }
  let context =
    args.context ?? loadActiveThreadProvisionContext(deps, thread.id);
  if (!context) {
    failThreadProvisioning(deps, {
      thread,
      environmentId: thread.environmentId,
      detail: "Thread setup did not finish. Retry the thread to continue.",
    });
    return;
  }
  if (thread.archivedAt !== null) {
    return;
  }

  try {
    const ready = await ensureThreadProvisionEnvironmentReady(deps, {
      context,
      thread,
    });
    context = ready.context;
    await startThreadIfEnvironmentReady(deps, {
      context: ready.context,
      environment: ready.environment,
      thread: ready.thread,
    });
  } catch (error) {
    const failureThread = getCurrentProvisioningFailureThread(deps, {
      context,
      threadId: thread.id,
    });
    if (!failureThread) {
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    failThreadProvisioning(deps, {
      thread: failureThread,
      environmentId:
        attachedEnvironmentIdForContext(context) ?? failureThread.environmentId,
      detail,
    });
  }
}

export async function advanceThreadProvisioning(
  deps: ThreadProvisioningDeps,
  args: AdvanceThreadProvisioningArgs,
): Promise<void> {
  await deps.lifecycleDedupers.threadProvisionAdvance.run(args.threadId, () =>
    advanceThreadProvisioningOnce(deps, args),
  );
}
