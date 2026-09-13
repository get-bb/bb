import {
  getEnvironment,
  getThread,
  type EnvironmentRow,
  type DbTransaction,
  type DbNotifier,
} from "@bb/db";
import {
  threadScope,
  type ProvisioningTranscriptEntry,
  type Thread,
} from "@bb/domain";
import type { AppDeps } from "../../types.js";
import type { CommandResultSideEffectsDeps } from "../../internal/command-result-side-effects.js";
import { ApiError } from "../../errors.js";
import { advanceEnvironmentProvisioning } from "../environments/environment-engine.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { requestQueuedMessageDispatch } from "./queued-message-dispatch.js";
import {
  appendSystemErrorEvent,
  appendThreadProvisioningEvent,
  appendThreadProvisioningEventInTransaction,
} from "./thread-events.js";
import { dispatchThreadRenameCommand } from "./thread-commands.js";
import { inferThreadMetadata } from "./thread-metadata-inference.js";
import { resolveEnvironmentProvider } from "./thread-environment-placement.js";
import {
  clearThreadProvisionSchedule,
  getThreadProvisionContext,
  saveThreadProvisionContext,
  type ThreadProvisionContext,
} from "./thread-startup-store.js";
import { applyLoggedThreadLifecycleEvent } from "./lifecycle-outcome.js";

export type ThreadProvisioningDeps = CommandResultSideEffectsDeps;
interface EnsureWorkspaceReadyEventArgs {
  entries: ProvisioningTranscriptEntry[];
  environmentId: string;
  threadId: string;
}

export function loadActiveThreadProvisionContext(
  deps: Pick<AppDeps, "db">,
  threadId: string,
) {
  const thread = getThread(deps.db, threadId);
  return thread?.status === "starting" && thread.deletedAt === null
    ? getThreadProvisionContext(deps.db, threadId)
    : null;
}

export function ensureWorkspaceReadyEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  args: EnsureWorkspaceReadyEventArgs,
): boolean {
  return deps.db.transaction(
    (tx) =>
      ensureWorkspaceReadyEventInTransaction({ db: tx, hub: deps.hub }, args),
    { behavior: "immediate" },
  );
}

export function ensureWorkspaceReadyEventInTransaction(
  deps: { db: DbTransaction; hub: DbNotifier },
  args: EnsureWorkspaceReadyEventArgs,
): boolean {
  const thread = getThread(deps.db, args.threadId);
  const context = getThreadProvisionContext(deps.db, args.threadId);
  if (
    thread?.status !== "starting" ||
    thread.deletedAt !== null ||
    context === null ||
    thread.environmentId !== args.environmentId
  )
    return false;
  if (context.state.workspaceReadyEventSequence !== null) return true;
  const appendedSequence =
    context.state.provisionEventSequence === null
      ? null
      : appendThreadProvisioningEventInTransaction(deps.db, {
          threadId: thread.id,
          environmentId: args.environmentId,
          provisioningId: context.state.provisioningId,
          status: "active",
          entries: args.entries,
        });
  context.state.workspaceReadyEventSequence = appendedSequence;
  saveThreadProvisionContext({
    replace: false,
    db: deps.db,
    threadId: thread.id,
    context,
  });
  if (appendedSequence !== null)
    deps.hub.notifyThread(thread.id, ["events-appended"], {
      eventTypes: ["system/thread-provisioning"],
    });
  return true;
}

interface FailThreadProvisioningArgs {
  detail: string;
  environmentId: string | null;
  thread: Thread;
}
export function failThreadProvisioning(
  deps: ThreadProvisioningDeps,
  args: FailThreadProvisioningArgs,
): void {
  const context = getThreadProvisionContext(deps.db, args.thread.id);
  clearThreadProvisionSchedule(args.thread.id);
  if (
    context !== null &&
    context.state.environmentId === null &&
    context.state.provisionEventSequence !== null
  ) {
    appendThreadProvisioningEvent(deps, {
      threadId: args.thread.id,
      environmentId: null,
      provisioningId: context.state.provisioningId,
      status: "failed",
      entries: [
        {
          type: "step",
          key: "workspace-failed",
          text: "Workspace setup failed",
          status: "failed",
          startedAt: Date.now(),
        },
      ],
    });
  }
  requestQueuedMessageDispatch(deps, {
    kind: "provisioning-ended",
    threadId: args.thread.id,
  });
  appendSystemErrorEvent(deps, {
    threadId: args.thread.id,
    environmentId: args.environmentId,
    code: "thread_provisioning_failed",
    message: "Provisioning thread failed",
    detail: args.detail,
    scope: threadScope(),
  });
  applyLoggedThreadLifecycleEvent(deps, {
    event: { type: "run.failed" },
    threadId: args.thread.id,
  });
}

export async function ensureThreadProvisionEnvironmentReady(
  deps: ThreadProvisioningDeps,
  args: { context: ThreadProvisionContext; thread: Thread },
): Promise<{
  context: ThreadProvisionContext;
  environment: EnvironmentRow;
  thread: Thread;
} | null> {
  const { context, thread } = args;
  if (
    context.state.environmentId === null &&
    context.state.provisionEventSequence === null
  ) {
    const intent = context.request.environmentIntent;
    if (
      intent.type === "provider" ||
      getEnvironment(deps.db, intent.environmentId)?.status !== "ready"
    ) {
      context.state.provisionEventSequence = appendThreadProvisioningEvent(
        deps,
        {
          threadId: thread.id,
          environmentId: thread.environmentId,
          provisioningId: context.state.provisioningId,
          status: "active",
          entries: [
            {
              type: "step",
              key: "workspace-started",
              text: "Preparing workspace",
              status: "started",
            },
          ],
        },
      );
      saveThreadProvisionContext({
        replace: false,
        db: deps.db,
        threadId: thread.id,
        context,
      });
    }
    if (context.request.environmentIntent.type === "provider") {
      if (!context.request.titleProvided)
        await inferThreadMetadata(deps, {
          input: context.request.input,
          provisioningId: context.state.provisioningId,
          threadId: thread.id,
          writeTranscript: true,
        });
    } else {
      if (!context.request.titleProvided) {
        void inferThreadMetadata(deps, {
          input: context.request.input,
          provisioningId: context.state.provisioningId,
          threadId: thread.id,
          writeTranscript: false,
        })
          .then((metadata) => {
            if (!metadata.titleApplied || !metadata.title) {
              return;
            }
            const titledThread = getThread(deps.db, thread.id);
            const environment = titledThread?.environmentId
              ? getEnvironment(deps.db, titledThread.environmentId)
              : null;
            if (
              !titledThread ||
              !environment ||
              (titledThread.status !== "active" &&
                titledThread.status !== "idle")
            ) {
              return;
            }
            dispatchThreadRenameCommand(deps, {
              environment: {
                id: environment.id,
                hostId: environment.hostId,
              },
              providerId: titledThread.providerId,
              threadId: titledThread.id,
              title: metadata.title,
            });
          })
          .catch((error) => {
            deps.logger.warn(
              {
                threadId: thread.id,
                ...runtimeErrorLogFields(deps.config, error),
              },
              "Failed to generate thread title",
            );
          });
      }
    }
  }
  if (
    getThreadProvisionContext(deps.db, thread.id)?.state.provisioningId !==
    context.state.provisioningId
  )
    return null;
  let environment: EnvironmentRow | null;
  if (context.request.environmentIntent.type === "provider") {
    const result = await resolveEnvironmentProvider(deps, { context, thread });
    if (result.kind === "waiting") return null;
    environment = result.environment;
  } else {
    environment = getEnvironment(
      deps.db,
      context.request.environmentIntent.environmentId,
    );
  }
  if (environment === null)
    throw new ApiError(404, "environment_not_found", "Environment not found");
  await advanceEnvironmentProvisioning(deps, {
    environmentId: environment.id,
    threadId: thread.id,
  });
  const attached = getThreadProvisionContext(deps.db, thread.id);
  if (attached === null || attached.state.environmentId !== environment.id)
    return null;

  return {
    context: attached,
    environment: getEnvironment(deps.db, environment.id) ?? environment,
    thread,
  };
}
