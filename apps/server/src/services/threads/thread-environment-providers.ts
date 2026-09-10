import {
  advanceProviderEnvironmentCreation,
  cancelProviderEnvironmentCreation,
} from "../environments/provider-orchestration.js";
import {
  getAppSettings,
  getEnvironment,
  getProjectSourceByHost,
  getThread,
  recordEnvironmentCurrentBranch,
} from "@bb/db";
import {
  isLocalPathProjectSource,
  type Environment,
  type ProvisioningTranscriptEntry,
  type Thread,
} from "@bb/domain";
import { ApiError } from "../../errors.js";
import {
  getNonDestroyedHostWithStatus,
  requirePublicProject,
} from "../lib/entity-lookup.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import {
  getEnvironmentProvider,
  listEnvironmentProviders,
} from "../plugins/plugin-environment-provider-registry.js";
import { buildSuggestedBranchName } from "./thread-create-helpers.js";
import { appendThreadProvisioningEvent } from "./thread-events.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { completeProviderSelection } from "./thread-environment-placement.js";
import {
  clearThreadProvisionSchedule,
  listThreadProvisionSchedules,
  saveThreadProvisionContext,
} from "./thread-startup-store.js";
import {
  resolveProviderPendingContext,
  type ThreadProvisionEnvironmentPendingContext,
  type ThreadProvisionProviderAsk,
  type ThreadProvisionProviderPendingContext,
} from "./thread-provisioning-context.js";
import { advanceThreadProvisioning } from "./thread-provisioning.js";
import { toThreadResponseFromThread } from "./thread-runtime-display.js";
import { toEnvironmentResponse } from "../environments/environment-response.js";
import type { ThreadProvisioningDeps } from "./thread-provisioning-environment.js";

const PROVIDER_UNAVAILABLE_RETRY_MS = 30_000;

const PROVIDER_REASK_FALLBACK_MS = 30_000;

const PROVIDER_LOG_CHUNK_MAX_TEXT = 16_384;

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function reaskLater(
  deps: ThreadProvisioningDeps,
  runtime: ThreadProvisionProviderAsk["runtime"],
  threadId: string,
  at: number,
): NodeJS.Timeout {
  const timer = setTimeout(
    () => {
      if (runtime.nextAskTimer !== timer) {
        return;
      }
      if (Date.now() < at) {
        runtime.nextAskTimer = reaskLater(deps, runtime, threadId, at);
        return;
      }
      runtime.nextAskTimer = null;
      void advanceThreadProvisioning(deps, { threadId })
        .catch((error) => {
          deps.logger.warn(
            { threadId, ...runtimeErrorLogFields(deps.config, error) },
            "Failed to re-ask an environment provider",
          );
        })
        .finally(() => {
          const askIsActive = listThreadProvisionSchedules().some(
            (entry) => entry.threadId === threadId && entry.runtime === runtime,
          );
          if (
            askIsActive &&
            runtime.recheckRequested &&
            runtime.nextAskTimer === null
          ) {
            runtime.nextAskTimer = reaskLater(
              deps,
              runtime,
              threadId,
              Date.now(),
            );
          }
        });
    },
    Math.min(Math.max(0, at - Date.now()), MAX_TIMER_DELAY_MS),
  );
  timer.unref?.();
  return timer;
}

export function recheckEnvironmentProviderCreations(
  deps: ThreadProvisioningDeps,
  pluginId: string,
): void {
  const owned = new Set(
    listEnvironmentProviders()
      .filter((record) => record.pluginId === pluginId)
      .map((record) => record.provider.id),
  );
  for (const {
    runtime,
    environmentProviderId,
    threadId,
  } of listThreadProvisionSchedules()) {
    if (!owned.has(environmentProviderId)) {
      continue;
    }
    if (runtime.nextAskTimer !== null) {
      clearTimeout(runtime.nextAskTimer);
    }
    runtime.recheckRequested = true;
    runtime.nextAskTimer = reaskLater(deps, runtime, threadId, Date.now());
  }
}

export function recheckEnvironmentProvisioning(
  deps: ThreadProvisioningDeps,
  targetThreadId: string,
): void {
  const entry = listThreadProvisionSchedules().find(
    ({ threadId }) => threadId === targetThreadId,
  );
  if (entry === undefined || entry.runtime.recheckRequested) return;
  const { runtime, threadId } = entry;
  if (runtime.nextAskTimer !== null) clearTimeout(runtime.nextAskTimer);
  runtime.recheckRequested = true;
  runtime.nextAskTimer = reaskLater(deps, runtime, threadId, Date.now());
}

export function scheduledEnvironmentProviderAskCount(): number {
  return listThreadProvisionSchedules().filter(
    ({ runtime }) => runtime.nextAskTimer !== null,
  ).length;
}

interface CancelEnvironmentProviderCreationArgs {
  environmentProviderId: string;
  threadId: string;
}

async function refreshAttachedEnvironmentBranch(
  deps: ThreadProvisioningDeps,
  args: { environmentId: string; hostId: string; path: string },
): Promise<void> {
  try {
    const inspection = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.inspect_git_source",
        path: args.path,
        remoteRefresh: "background",
      },
    });
    const checkout = inspection.checkout;
    const branchName =
      checkout.kind === "branch" || checkout.kind === "unborn"
        ? checkout.branchName
        : null;
    recordEnvironmentCurrentBranch(deps.db, deps.hub, args.environmentId, {
      branchName,
      defaultBranch: inspection.defaultBranch ?? branchName,
    });
  } catch (error) {
    deps.logger.warn(
      {
        environmentId: args.environmentId,
        hostId: args.hostId,
        ...runtimeErrorLogFields(deps.config, error),
      },
      "Could not refresh the branch of a reused environment",
    );
  }
}

export function cancelAbandonedProviderCreations(
  deps: ThreadProvisioningDeps,
  threadId: string,
): void {
  void cancelProviderEnvironmentCreation(deps, threadId).catch((error) =>
    deps.logger.warn({ threadId, error }, "Environment cancellation failed"),
  );
}

export function cancelEnvironmentProviderCreation(
  deps: ThreadProvisioningDeps,
  args: CancelEnvironmentProviderCreationArgs,
): void {
  clearThreadProvisionSchedule(args.threadId);
  void cancelProviderEnvironmentCreation(deps, args.threadId).catch((error) => {
    deps.logger.warn(
      { threadId: args.threadId, error },
      "Environment provider cancel failed",
    );
  });
}

function providerFailure(
  environmentProviderId: string,
  pluginId: string | null,
  detail: string,
): ApiError {
  const owner = pluginId === null ? "" : ` (plugin "${pluginId}")`;
  return new ApiError(
    502,
    "environment_provider_failed",
    `The "${environmentProviderId}" environment provider${owner} failed: ${detail}`,
    { details: { environmentProviderId, pluginId } },
  );
}

interface ProvisioningEntriesArgs {
  ask: ThreadProvisionProviderAsk;
  log: string | undefined;
  now: number;
  step: { text: string; status: "started" | "completed" } | null;
}

function provisioningEntries(
  args: ProvisioningEntriesArgs,
): ProvisioningTranscriptEntry[] {
  const entries: ProvisioningTranscriptEntry[] = [];
  const { ask } = args;
  if (args.step !== null && ask.lastStep?.text !== args.step.text) {
    if (ask.lastStep !== null) {
      entries.push({
        type: "step",
        key: ask.lastStep.key,
        text: ask.lastStep.text,
        status: "completed",
        startedAt: ask.lastStep.startedAt,
        metadata: { durationMs: args.now - ask.lastStep.startedAt },
      });
    }
    const key = `provider-step-${ask.stepCount}`;
    ask.stepCount += 1;
    ask.lastStep = { key, text: args.step.text, startedAt: args.now };
    entries.push({
      type: "step",
      key,
      text: args.step.text,
      status: args.step.status,
      startedAt: args.now,
    });
  } else if (
    args.step !== null &&
    args.step.status === "completed" &&
    ask.lastStep !== null
  ) {
    entries.push({
      type: "step",
      key: ask.lastStep.key,
      text: ask.lastStep.text,
      status: "completed",
      startedAt: ask.lastStep.startedAt,
      metadata: { durationMs: args.now - ask.lastStep.startedAt },
    });
  }
  if (args.log !== undefined && args.log.length > 0) {
    entries.push({
      type: "output",
      key: `provider-output-${ask.outputCount}`,
      text: args.log.slice(-PROVIDER_LOG_CHUNK_MAX_TEXT),
    });
    ask.outputCount += 1;
  }
  return entries;
}

interface RecordWaitArgs {
  context: ThreadProvisionProviderPendingContext;
  log: string | undefined;
  reason: string;
  sendAt: number | null;
  thread: Thread;
}

function recordWait(deps: ThreadProvisioningDeps, args: RecordWaitArgs): void {
  const ask = args.context.state.providerAsk;
  const entries = provisioningEntries({
    ask,
    log: args.log,
    now: Date.now(),
    step: { text: args.reason, status: "started" },
  });
  if (entries.length > 0) {
    appendThreadProvisioningEvent(deps, {
      threadId: args.thread.id,
      environmentId: null,
      provisioningId: args.context.state.provisioningId,
      status: "active",
      entries,
    });
  }
  if (ask.runtime.nextAskTimer !== null) {
    clearTimeout(ask.runtime.nextAskTimer);
  }
  const reaskAt = ask.runtime.recheckRequested
    ? Date.now()
    : (args.sendAt ?? Date.now() + PROVIDER_REASK_FALLBACK_MS);
  ask.runtime.recheckRequested = false;
  ask.runtime.nextAskTimer = reaskLater(
    deps,
    ask.runtime,
    args.thread.id,
    reaskAt,
  );
  saveThreadProvisionContext({
    db: deps.db,
    replace: false,
    threadId: args.thread.id,
    context: args.context,
  });
}

interface ResolveEnvironmentProviderArgs {
  context: ThreadProvisionProviderPendingContext;
  thread: Thread;
}

export type EnvironmentProviderResolution =
  | { kind: "resolved"; context: ThreadProvisionEnvironmentPendingContext }
  | { kind: "waiting" };

export async function resolveEnvironmentProvider(
  deps: ThreadProvisioningDeps,
  args: ResolveEnvironmentProviderArgs,
): Promise<EnvironmentProviderResolution> {
  const context = args.context;
  const intent = context.request.environmentIntent;
  if (intent.type !== "provider" || intent.produced !== null) {
    throw new Error("A provider-pending thread has no provider intent");
  }

  const ask = context.state.providerAsk;
  ask.runtime.recheckRequested = false;
  const record = getEnvironmentProvider(intent.environmentProviderId);
  if (record === undefined) {
    recordWait(deps, {
      context,
      log: undefined,
      reason: `Waiting for the "${intent.environmentProviderId}" environment provider, which is not registered by any running plugin`,
      sendAt: Date.now() + PROVIDER_UNAVAILABLE_RETRY_MS,
      thread: args.thread,
    });
    return { kind: "waiting" };
  }

  const thread = getThread(deps.db, args.thread.id);
  if (thread === null || thread.status !== "starting") {
    throw new Error("Thread provisioning context is no longer active");
  }
  const project = requirePublicProject(deps.db, thread.projectId);
  let selection;
  try {
    selection = intent.selectionResolved
      ? { machine: intent.machine, inputs: intent.inputs }
      : await completeProviderSelection(deps, record, thread.projectId, {
          machine: intent.machine,
          inputs: intent.inputs,
        });
  } catch (error) {
    throw providerFailure(
      intent.environmentProviderId,
      record.pluginId,
      error instanceof Error ? error.message : String(error),
    );
  }
  const host = getNonDestroyedHostWithStatus(deps, selection.machine.hostId);
  if (host === null) {
    throw providerFailure(
      intent.environmentProviderId,
      record.pluginId,
      "runs on a machine that no longer exists",
    );
  }
  const requires = record.provider.requires;
  if (requires.gitRemote && project.gitRemoteUrl === null) {
    throw new ApiError(
      409,
      "environment_provider_rejected",
      `${project.name} has no git remote, so the "${intent.environmentProviderId}" environment provider has nothing to clone.`,
      { details: { environmentProviderId: intent.environmentProviderId } },
    );
  }
  const checkout = getProjectSourceByHost(deps.db, thread.projectId, host.id);
  const projectCheckout =
    checkout !== null && isLocalPathProjectSource(checkout)
      ? { path: checkout.path }
      : null;
  if (requires.projectCheckout && projectCheckout === null) {
    throw providerFailure(
      intent.environmentProviderId,
      record.pluginId,
      "works from this project's checkout on the machine, which is no longer configured",
    );
  }
  intent.machine = selection.machine;
  intent.inputs = selection.inputs;
  intent.selectionResolved = true;
  const provisionContext = {
    thread: toThreadResponseFromThread(deps, { thread }),
    project,
    host,
    machine: selection.machine,
    projectCheckout,
    gitRemote: requires.gitRemote ? project.gitRemoteUrl : null,
    inputs: selection.inputs,
    suggestedBranchName: buildSuggestedBranchName({
      branchPrefix: getAppSettings(deps.db).managedBranchPrefix,
      title: thread.title ?? thread.titleFallback,
      threadId: thread.id,
    }),
    environment: threadProvisionContextEnvironment(deps, thread.environmentId),
  };
  const decision = advanceProviderEnvironmentCreation(
    deps,
    record,
    provisionContext,
  );
  if (decision.action === "reject") {
    const entries = provisioningEntries({
      ask,
      log: decision.log,
      now: Date.now(),
      step: null,
    });
    if (entries.length > 0)
      appendThreadProvisioningEvent(deps, {
        threadId: thread.id,
        environmentId: null,
        provisioningId: context.state.provisioningId,
        status: "active",
        entries,
      });
    throw new ApiError(409, "environment_provider_rejected", decision.message, {
      details: { environmentProviderId: intent.environmentProviderId },
    });
  }
  if (decision.action === "wait") {
    recordWait(deps, {
      context,
      log: decision.log,
      reason: decision.reason,
      sendAt: decision.sendAt ?? null,
      thread,
    });
    return { kind: "waiting" };
  }
  if (ask.runtime.nextAskTimer !== null) {
    clearTimeout(ask.runtime.nextAskTimer);
    ask.runtime.nextAskTimer = null;
  }
  const entries = provisioningEntries({
    ask,
    log: decision.log,
    now: Date.now(),
    step:
      ask.lastStep === null
        ? null
        : { text: ask.lastStep.text, status: "completed" },
  });
  if (entries.length > 0) {
    appendThreadProvisioningEvent(deps, {
      threadId: thread.id,
      environmentId: null,
      provisioningId: context.state.provisioningId,
      status: "active",
      entries,
    });
  }
  const environment = decision.environment;
  if (environment.path === null)
    throw new Error("Prepared environment has no path");
  const environmentIntent =
    environment.status === "ready"
      ? { type: "reuse" as const, environmentId: environment.id }
      : {
          ...intent,
          produced: {
            hostId: environment.hostId,
            path: environment.path,
            ownsPath: environment.providerOwnsPath,
            mergeBaseBranch: environment.mergeBaseBranch,
          },
        };
  if (environmentIntent.type === "reuse") {
    await refreshAttachedEnvironmentBranch(deps, {
      environmentId: environment.id,
      hostId: environment.hostId,
      path: environment.path,
    });
  }
  const resolved = resolveProviderPendingContext(context, {
    environmentIntent,
    producedBy: {
      environmentProviderId: intent.environmentProviderId,
      instanceKey: environment.environmentProviderInstanceKey,
      selection,
    },
  });
  saveThreadProvisionContext({
    replace: false,
    db: deps.db,
    threadId: thread.id,
    context: resolved,
  });
  return { kind: "resolved", context: resolved };
}

function threadProvisionContextEnvironment(
  deps: Pick<ThreadProvisioningDeps, "db">,
  environmentId: string | null,
): Environment | null {
  if (environmentId === null) {
    return null;
  }
  const environment = getEnvironment(deps.db, environmentId);
  return environment === null ? null : toEnvironmentResponse(environment);
}
