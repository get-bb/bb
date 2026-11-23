import {
  MAX_WORKSPACE_FOLDERS,
  validateReplacedProjectFolders,
  validateWorkspaceFolderPaths,
} from "../projects/workspace-folder-paths.js";
import { emitPluginEnvironmentRemoved } from "../plugins/plugin-thread-events.js";
import { withHostCleanup } from "../hosts/cleanup-context.js";
import { preservePathPluginsInside } from "../plugins/path-plugin-preservation.js";
import { findHostDataDir } from "../lib/entity-lookup.js";
import {
  getLatestThreadSequence,
  nextPersistedRetryAt,
  persistedRetryExhausted,
  updateThread,
} from "@bb/db";
import {
  TEARDOWN_RETRY_DELAYS_MS,
  needsRecoveryMessage,
} from "../lib/persisted-retry.js";
import {
  assertEnvironmentPathAvailable,
  findBlockingEnvironmentPathClaim,
} from "./path-admission.js";
import { saveThreadProvisionContext } from "../threads/thread-startup-store.js";
import {
  locateEnvironment,
  resolveHeldEnvironmentOperationContext,
} from "./environment-creation.js";
import {
  refreshAttachedEnvironmentBranch,
  resolveProviderOperationContext,
} from "../threads/thread-environment-placement.js";
import { withEnvironmentCleanupSlot } from "./cleanup-concurrency.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import { foreignProjectOwnedPathRefusal } from "../threads/workspace-path-claims.js";
import {
  cancelPendingEnvironmentHook,
  isEnvironmentHookOutcomeUnknown,
  runEnvironmentHook,
  runEnvironmentTeardownHook,
  type EnvironmentHookProgressSink,
} from "./environment-hooks.js";
import { z } from "zod";
import {
  acknowledgeInterruptedEnvironmentHookOperation,
  releaseFinishedEnvironmentPreparationOwners,
  environmentHasLiveThreads,
  getEnvironment,
  getEnvironmentHookOperation,
  getStartingLiveEnvironmentThread,
  hasEnvironmentHookOperation,
  listEnvironmentThreads,
  listHostEnvironmentRemovalStates,
  listProvisioningEnvironmentIdsOnHost,
  listStartingLiveEnvironmentThreadIds,
  listStoppingLiveEnvironmentThreads,
  listUndeletedEnvironmentThreads,
  recordEnvironmentTeardownFailure,
  setEnvironmentColumns,
  getHost,
  getThread,
  findProjectEnvironmentByHostPath,
  getPreparingEnvironment,
  claimEnvironmentPath,
  bindEnvironmentPath,
  adoptHeldEnvironment,
  releaseEnvironmentHolds,
  listProviderLifecycleEnvironments,
  updatePreparingEnvironment,
  type DbConnection,
  type DbTransaction,
  type EnvironmentRow,
  hasStoredCancelledThreadProvisioning,
  type DbNotifier,
  type DbQueryConnection,
  markHostEnvironmentsDestroyed,
} from "@bb/db";
import {
  areHostPathsEqual,
  canonicalizeHostPath,
  isAbsoluteHostPath,
  jsonValueSchema,
  type Environment,
  type EnvironmentMachineSelection,
  type Host,
  type JsonValue,
  type Project,
  type ProvisioningTranscriptEntry,
  type SystemThreadProvisioningStatus,
  type ThreadStatus,
  threadScope,
} from "@bb/domain";
import {
  type OperationResponse,
  type ThreadResponse,
} from "@bb/server-contract";
import {
  type PluginEnvironmentProviderCreateContext,
  type PluginEnvironmentProviderCreateResult,
  type PluginEnvironmentProviderEnvironment,
  type PluginEnvironmentProviderSteps,
  type PluginEnvironmentProviderProgress,
  type PluginEnvironmentProviderRestoreContext,
} from "@get-bb/plugin-sdk/environment-provider";
import type { PluginEnvironmentProviderV1CreateContext } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  type ThreadProvisioningDeps,
  ensureWorkspaceReadyEventInTransaction,
  queueChildSetupFailureNotification,
} from "../threads/thread-provisioning-environment.js";
import { toEnvironmentResponse } from "./environment-response.js";
import {
  getEnvironmentProvider,
  invokeEnvironmentProvider,
  listEnvironmentProviders,
  requestEnvironmentProvisioningRecheck,
  type PluginEnvironmentProviderRecord,
} from "../plugins/plugin-environment-provider-registry.js";
import {
  applyLoggedEnvironmentLifecycleEvent,
  applyLoggedEnvironmentLifecycleEventInTransaction,
} from "./lifecycle-outcome.js";
import { buildEnvironmentProvisionCommand } from "../threads/thread-create-helpers.js";
import { recordProvisionedEnvironmentWorkspace } from "@bb/db/internal-environment-lifecycle";
import { type AppDeps } from "../../types.js";
import {
  appendThreadProvisioningEvent,
  appendSystemErrorEventInTransaction,
  appendThreadProvisioningEventInTransaction,
  buildCwdBranchEntries,
} from "../threads/thread-events.js";
import { type EnvironmentProvisionRequest } from "./environment-provision-request.js";
import {
  createLiveHostCommandExecution,
  expectedLiveHostCommandErrorLogFields,
  LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  runLiveHostCommand,
  settleLiveHostCommandFailure,
} from "../hosts/live-command.js";
import { runThreadLifecycleInTransaction } from "../threads/lifecycle/run.js";
import {
  finishThreadLifecycle,
  finishThreadLifecycleInBackground,
} from "../threads/lifecycle/finish.js";
import {
  clearThreadProvisionSchedule,
  getThreadProvisionContext,
} from "../threads/thread-startup-store.js";
import { advanceThreadProvisioning } from "../threads/thread-provisioning.js";
import {
  finalizeStoppedThreadInTransaction,
  finalizeStoppedThreadPostCommit,
  requestThreadStopForCurrentState,
} from "../threads/thread-lifecycle.js";
import type { ThreadLifecycleOutcome } from "../threads/lifecycle/run.js";
import {
  emptyCommandResultSideEffects,
  type CommandResultPostCommitAction,
  type CommandResultSideEffectsDeps,
  type CommandResultReportForType,
  type CommandResultSideEffectsResult,
  type HostDaemonCommandExecutionRecord,
  type HostDaemonCommandForType,
} from "../../internal/command-result-side-effects.js";
import { errorMessage } from "../lib/error-log-fields.js";
import { perDbRegistry } from "../lib/per-db-registry.js";
import { NotificationBuffer } from "../lib/notification-buffer.js";
import {
  callHostOnlineRpc,
  isHostUnavailableApiError,
} from "../hosts/online-rpc.js";
import { ApiError } from "../../errors.js";
import {
  operationComplete,
  operationInProgress,
} from "../lib/operation-response.js";
import { defineItemSweep, type ItemSweep } from "../system/item-sweep.js";
import { sliceUtf16Head } from "@bb/text-utils";

type Deps = ThreadProvisioningDeps;

export interface ProviderOperationContext {
  thread: ThreadResponse | null;
  project: Project;
  host: Host;
  machine: EnvironmentMachineSelection;
  projectCheckout: { path: string; ownsPath: boolean } | null;
  gitRemote: string | null;
  inputs: JsonValue | null;
  branchName(): Promise<string>;
  previous: Environment | null;
}

export type ThreadProviderOperationContext = ProviderOperationContext & {
  thread: ThreadResponse;
};

interface ActiveOperation {
  kind: "create" | "attach" | "remove";
  controller: AbortController;
  done: Promise<void>;
  cancellation: Promise<void> | null;
}

const resourceSchema = jsonValueSchema.refine(
  (value) => Buffer.byteLength(JSON.stringify(value)) <= 16_384,
  "Resource exceeds 16 KiB",
);
const createResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("created"),
    path: z.string().min(1),
    ownsPath: z.boolean().default(false),
    mergeBaseBranch: z.string().min(1).nullable().optional(),
    additionalPaths: z.array(z.string()).max(MAX_WORKSPACE_FOLDERS).optional(),
    replacedProjectFolders: z
      .array(z.string())
      .max(MAX_WORKSPACE_FOLDERS)
      .optional(),
    resource: resourceSchema.optional(),
  }),
  z.object({
    status: z.literal("failed"),
    message: z.string().min(1),
  }),
]);
const removeResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("removed") }),
  z.object({ status: z.literal("failed"), message: z.string().min(1) }),
]);
const environmentOperations = new WeakMap<
  object,
  Map<string, ActiveOperation>
>();
const createOperations = new WeakMap<object, Map<string, ActiveOperation>>();

function writeEnvironment(
  deps: Pick<Deps, "db" | "hub">,
  environmentId: string,
  change: Partial<EnvironmentRow>,
): void {
  setEnvironmentColumns(deps.db, environmentId, {
    ...change,
    updatedAt: Date.now(),
  });
  deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
}

function currentProvisioningRow(
  deps: Deps,
  provisioning: EnvironmentRow,
  phases: EnvironmentRow["status"][],
): EnvironmentRow | null {
  const row = getEnvironment(deps.db, provisioning.id);
  return row !== null &&
    row.attempt === provisioning.attempt &&
    (row.ownerThreadId === provisioning.ownerThreadId ||
      (row.createPending && row.ownerThreadId === null)) &&
    phases.includes(row.status)
    ? row
    : null;
}

function mutateProvisioning(
  deps: Deps,
  provisioning: EnvironmentRow,
  phases: EnvironmentRow["status"][],
  change: (row: EnvironmentRow) => void,
): boolean {
  const row = currentProvisioningRow(deps, provisioning, phases);
  if (row === null) return false;
  const before = JSON.stringify(row);
  change(row);
  if (JSON.stringify(row) === before) return false;
  const updated = updatePreparingEnvironment(deps.db, row);
  if (updated) deps.hub.notifyEnvironment(row.id, ["metadata-changed"]);
  return updated;
}

function provisioningReporter(
  deps: Deps,
  current: () => EnvironmentRow,
): PluginEnvironmentProviderProgress {
  const report = (
    change: (row: EnvironmentRow) => void,
    step: string | null,
  ) => {
    const provisioning = current();
    const before = getEnvironment(deps.db, provisioning.id);
    if (
      !mutateProvisioning(
        deps,
        provisioning,
        before?.status === "ready" && before.createPending
          ? ["ready"]
          : ["creating", "provisioning"],
        change,
      )
    )
      return;
    const owner = provisioning.ownerThreadId;
    if (owner === null) return;
    const context = getThreadProvisionContext(deps.db, owner);
    if (context !== null)
      deps.db.transaction((tx) => {
        const row = getEnvironment(tx, provisioning.id);
        if (row === null) return;
        const entries: ProvisioningTranscriptEntry[] = [];
        const key = (text: string) => `provider-step-${row.attempt}-${text}`;
        if (step !== null) {
          if (before?.statusMessage)
            entries.push({
              type: "step",
              key: key(before.statusMessage),
              text: before.statusMessage,
              status: "completed",
            });
          entries.push({
            type: "step",
            key: key(step),
            text: step,
            status: "started",
          });
        }
        if (row.pendingLog !== "")
          entries.push({
            type: "output",
            key: `provider-output-${row.attempt}-${Date.now()}`,
            text: row.pendingLog,
          });
        if (entries.length > 0)
          appendThreadProvisioningEventInTransaction(tx, {
            threadId: owner,
            environmentId: row.id,
            provisioningId: context.state.provisioningId,
            status: "active",
            entries,
          });
        setEnvironmentColumns(tx, row.id, { pendingLog: "" });
        deps.hub.notifyThread(owner, ["events-appended"], {
          timelineSequence: getLatestThreadSequence(deps.db, {
            threadId: owner,
          }),
          eventTypes: ["system/thread-provisioning"],
        });
      });
    requestEnvironmentProvisioningRecheck(owner);
  };
  return {
    step: (text) =>
      report(
        (row) => {
          row.statusMessage = sliceUtf16Head(text, 200);
        },
        sliceUtf16Head(text, 200),
      ),
    log: (text) =>
      report((row) => {
        row.pendingLog = (row.pendingLog + text).slice(-16_384);
      }, null),
  };
}

function removalReporter(
  deps: Pick<Deps, "logger">,
  environmentId: string,
): PluginEnvironmentProviderProgress {
  const log = (text: string) =>
    deps.logger.info({ environmentId, text }, "Environment removal");
  return { step: log, log };
}

function runTrackedOperation(args: {
  kind: ActiveOperation["kind"];
  map: Map<string, ActiveOperation>;
  key: string;
  run: (signal: AbortSignal) => Promise<void>;
}): ActiveOperation {
  const existing = args.map.get(args.key);
  if (existing !== undefined) return existing;
  const controller = new AbortController();
  const operation: ActiveOperation = {
    kind: args.kind,
    controller,
    done: Promise.resolve(),
    cancellation: null,
  };
  const track = async () => {
    try {
      await args.run(controller.signal);
    } finally {
      await operation.cancellation;
      if (args.map.get(args.key) === operation) args.map.delete(args.key);
    }
  };
  operation.done = track();
  args.map.set(args.key, operation);
  return operation;
}

const PROVIDER_OWNER_MISMATCH_MESSAGE =
  "The environment provider belongs to a different plugin or has no recorded owner. Automatic removal is blocked.";

const RETIRED_CREATE_CONTEXT_FIELDS = { rebuild: false, previous: null };

const providerPathSchema = z
  .string()
  .min(1)
  .refine(isAbsoluteHostPath)
  .refine((path) => !path.includes("\0"));

export function versionOneThreadlessRefusal(
  record: PluginEnvironmentProviderRecord,
): string {
  return `${record.provider.displayName} can't create an environment before a thread exists`;
}

type ProviderSteps = PluginEnvironmentProviderSteps & {
  environment: PluginEnvironmentProviderEnvironment;
};

type ProviderOperationBase = Omit<
  PluginEnvironmentProviderCreateContext,
  keyof ProviderSteps
>;

type ClaimPath =
  PluginEnvironmentProviderV1CreateContext["experimental_claimPath"];

function versionOneOperation(
  operation: ProviderOperationBase,
  claimPath: ClaimPath,
) {
  const checkout = operation.projectCheckout;
  return {
    ...operation,
    projectCheckout:
      checkout === null
        ? null
        : { path: checkout.path, experimental_ownsPath: checkout.ownsPath },
    experimental_claimPath: claimPath,
  };
}

function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function titledThread(deps: Deps, thread: ThreadResponse): ThreadResponse {
  return { ...thread, title: getThread(deps.db, thread.id)?.title ?? null };
}

async function invokeCreate(
  deps: Deps,
  record: PluginEnvironmentProviderRecord,
  context: ProviderOperationContext,
  operation: ProviderOperationBase,
  steps: ProviderSteps,
  claimPath: ClaimPath,
): Promise<PluginEnvironmentProviderCreateResult> {
  const provider = record.provider;
  const invocation = await invokeEnvironmentProvider(
    record,
    "environment create",
    async () => {
      if (provider.apiVersion === 2)
        return provider.create({ ...operation, ...steps });
      const thread = context.thread;
      if (thread === null) throw new Error(versionOneThreadlessRefusal(record));
      const suggestedBranchName = await untilAborted(
        context.branchName(),
        operation.signal,
      );
      return provider.create({
        ...RETIRED_CREATE_CONTEXT_FIELDS,
        ...versionOneOperation(operation, claimPath),
        thread: titledThread(deps, thread),
        suggestedBranchName,
      });
    },
  );
  if (!invocation.ok) throw new Error(invocation.error);
  if (invocation.value === null)
    throw new Error("The environment provider became unavailable.");
  return createResultSchema.parse(invocation.value);
}

function providerEnvironment(
  row: EnvironmentRow,
): PluginEnvironmentProviderEnvironment {
  return { id: row.id, name: row.name, projectId: row.projectId };
}

async function invokeRestore(
  record: PluginEnvironmentProviderRecord,
  context: ProviderOperationContext,
  operation: ProviderOperationBase & {
    previous: PluginEnvironmentProviderRestoreContext["previous"];
  },
  steps: ProviderSteps,
  claimPath: ClaimPath,
): Promise<PluginEnvironmentProviderCreateResult> {
  const restore = providerRestoreCall(
    record,
    context,
    operation,
    steps,
    claimPath,
  );
  if (restore === null) {
    return {
      status: "failed",
      message: `The "${record.provider.displayName}" environment provider cannot restore a removed environment.`,
    };
  }
  const invocation = await invokeEnvironmentProvider(
    record,
    "environment restore",
    restore,
  );
  if (!invocation.ok) throw new Error(invocation.error);
  if (invocation.value === null)
    throw new Error("The environment provider became unavailable.");
  return createResultSchema.parse(invocation.value);
}

function providerRestoreCall(
  record: PluginEnvironmentProviderRecord,
  context: ProviderOperationContext,
  operation: ProviderOperationBase & {
    previous: PluginEnvironmentProviderRestoreContext["previous"];
  },
  steps: ProviderSteps,
  claimPath: ClaimPath,
): (() => Promise<PluginEnvironmentProviderCreateResult>) | null {
  const provider = record.provider;
  if (provider.apiVersion === 2) {
    const restore = provider.restore;
    return restore === null ? null : () => restore({ ...operation, ...steps });
  }
  const restore = provider.restore;
  if (restore === null) return null;
  const thread = context.thread;
  return () =>
    thread === null
      ? Promise.reject(new Error(versionOneThreadlessRefusal(record)))
      : restore({
          ...versionOneOperation(operation, claimPath),
          previous: operation.previous,
          thread,
        });
}

async function runCreate(
  deps: Deps,
  record: PluginEnvironmentProviderRecord,
  provisioning: EnvironmentRow,
  context: ProviderOperationContext,
  outerSignal: AbortSignal,
): Promise<void> {
  const signal = outerSignal;
  let changed = false;
  mutateProvisioning(deps, provisioning, ["creating"], (row) => {
    row.hostId = context.host.id;
  });
  let adoptedExistingEnvironment = false;
  let existingProviderOwnsLifecycle = false;
  let handedOff = false;
  const requested: { path: string | null } = {
    path: provisioning.status === "creating" ? null : provisioning.path,
  };
  const target: { row: EnvironmentRow | null } = { row: null };
  const bindPath = async (producedPath: string) => {
    await ensureHostSessionReadyForWork(deps, { hostId: context.host.id });
    findBlockingEnvironmentPathClaim(deps, {
      hostId: context.host.id,
      path: producedPath,
      owner: provisioning,
    });
    deps.db.transaction(
      () => {
        const refusal = foreignProjectOwnedPathRefusal(deps.db, {
          hostId: context.host.id,
          path: producedPath,
          projectId: context.project.id,
        });
        if (refusal !== null) throw new Error(refusal);
        if (!claimEnvironmentPath(deps.db, provisioning, producedPath, true))
          throw new Error(
            "Workspace path is already claimed by another provisioning.",
          );
        const declared = target.row;
        if (
          declared !== null &&
          declared.path !== null &&
          areHostPathsEqual(declared.path, producedPath)
        ) {
          existingProviderOwnsLifecycle =
            declared.environmentProviderId !== null;
        }
        const reservedId = provisioning.id;
        provisioning = bindEnvironmentPath(
          deps.db,
          provisioning,
          producedPath,
          declared?.id ?? null,
        );
        adoptedExistingEnvironment ||= provisioning.id !== reservedId;
      },
      { behavior: "immediate" },
    );
  };
  const requestSetup = async (value: string): Promise<void> => {
    const path = canonicalizeHostPath(providerPathSchema.parse(value));
    if (requested.path !== null) {
      if (!areHostPathsEqual(requested.path, path))
        throw new Error(`Setup was already requested at ${requested.path}`);
      return;
    }
    signal.throwIfAborted();
    if (handedOff) {
      if (
        provisioning.path === null ||
        !areHostPathsEqual(provisioning.path, path)
      )
        throw new Error(
          `Setup can't run at ${path}: the adopted environment is at ${provisioning.path}`,
        );
      requested.path = path;
      applyLoggedEnvironmentLifecycleEvent(deps, {
        environmentId: provisioning.id,
        event: { type: "provision.requested" },
      });
      if (provisioning.ownerThreadId !== null)
        requestEnvironmentProvisioningRecheck(provisioning.ownerThreadId);
      return;
    }
    const declared = target.row;
    if (declared?.path != null && areHostPathsEqual(declared.path, path))
      throw new Error(
        `Setup can't run at ${path}: it belongs to environment ${declared.id}`,
      );
    await bindPath(path);
    requested.path = path;
    mutateProvisioning(deps, provisioning, ["creating"], (row) => {
      row.path = path;
      row.providerOwnsPath = true;
      if (row.ownerThreadId === null) row.claimPath = null;
    });
    applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId: provisioning.id,
      event: { type: "provision.requested" },
    });
    if (provisioning.ownerThreadId !== null)
      requestEnvironmentProvisioningRecheck(provisioning.ownerThreadId);
    else
      void advanceEnvironmentProvisioning(deps, {
        environmentId: provisioning.id,
      });
  };
  const createMap = perDbRegistry(createOperations, deps.db);
  let running: ActiveOperation | undefined;
  const adopt = async (
    environmentId: string,
    resource: JsonValue,
  ): Promise<void> => {
    signal.throwIfAborted();
    if (requested.path !== null || adoptedExistingEnvironment)
      throw new Error("adopt must come before setup and only once");
    running = createMap.get(provisioning.id);
    provisioning = adoptHeldEnvironment(
      deps.db,
      provisioning,
      environmentId,
      `plugin:${record.pluginId}`,
      resourceSchema.parse(resource),
    );
    if (running !== undefined) createMap.set(provisioning.id, running);
    adoptedExistingEnvironment = true;
    existingProviderOwnsLifecycle = true;
    handedOff = true;
  };
  const forgetAdoption = () => {
    if (running !== undefined && createMap.get(provisioning.id) === running)
      createMap.delete(provisioning.id);
  };
  const steps: ProviderSteps = {
    environment: providerEnvironment(provisioning),
    branchName: () => untilAborted(context.branchName(), signal),
    setup: requestSetup,
    adopt,
  };
  let failure: string | null = null;
  try {
    const previous =
      context.previous === null
        ? null
        : getEnvironment(deps.db, context.previous.id);
    const operation: ProviderOperationBase = {
      project: context.project,
      host: context.host,
      projectCheckout: context.projectCheckout,
      gitRemote: context.gitRemote,
      inputs: context.inputs,
      pathKey: provisioning.environmentProviderInstanceKey ?? provisioning.id,
      attempt: provisioning.attempt,
      report: provisioningReporter(deps, () => provisioning),
      signal: signal,
    };
    const located = await locateEnvironment(deps, record, {
      projectId: context.project.id,
      host: context.host,
      projectCheckout: context.projectCheckout,
      inputs: context.inputs,
    });
    if (
      located?.environment != null &&
      located.environment.id !== provisioning.id
    )
      target.row = located.environment;
    const claimPath: ClaimPath = async (value) => {
      const path = providerPathSchema.parse(value);
      if (signal.aborted) return false;
      const normalizedPath = canonicalizeHostPath(path);
      if (
        findBlockingEnvironmentPathClaim(deps, {
          hostId: context.host.id,
          path: normalizedPath,
          owner: provisioning,
        }) !== null
      )
        return false;
      return claimEnvironmentPath(deps.db, provisioning, normalizedPath);
    };
    let result =
      !provisioning.createPending &&
      provisioning.providerOwnsPath &&
      provisioning.path !== null
        ? {
            status: "created" as const,
            path: provisioning.path,
            ownsPath: true,
            mergeBaseBranch: provisioning.mergeBaseBranch ?? undefined,
            additionalPaths: provisioning.additionalPaths,
            replacedProjectFolders: provisioning.replacedProjectFolders,
            resource: provisioning.resource ?? undefined,
          }
        : previous?.status === "destroyed"
          ? await invokeRestore(
              record,
              context,
              {
                ...operation,
                previous: {
                  environment: toEnvironmentResponse(deps.db, previous),
                  resource:
                    previous.teardownStatus === "removed"
                      ? null
                      : previous.resource,
                },
              },
              steps,
              claimPath,
            )
          : await invokeCreate(
              deps,
              record,
              context,
              operation,
              steps,
              claimPath,
            );
    const setupPath = requested.path;
    if (result.status === "created") {
      const created = result;
      const producedPath = canonicalizeHostPath(result.path);
      if (record.provider.apiVersion === 1 && target.row === null) {
        const existing = findProjectEnvironmentByHostPath(
          deps.db,
          context.project.id,
          context.host.id,
          producedPath,
        );
        if (
          existing !== null &&
          existing.environmentProviderId !== null &&
          (existing.environmentProviderId !== record.provider.id ||
            existing.environmentProviderPluginId !== record.pluginId)
        )
          throw new Error(
            `Workspace ${producedPath} is owned by the "${existing.environmentProviderId}" environment provider (plugin "${existing.environmentProviderPluginId ?? "unknown"}").`,
          );
        if (existing !== null && existing.id !== provisioning.id)
          target.row = existing;
      }
      if (handedOff) {
        if (
          provisioning.path === null ||
          !areHostPathsEqual(producedPath, provisioning.path)
        )
          throw new Error(
            `The provider adopted ${provisioning.id} but created ${producedPath}`,
          );
      } else if (setupPath !== null) {
        if (!areHostPathsEqual(producedPath, setupPath) || !created.ownsPath)
          throw new Error(
            `The provider requested setup at ${setupPath} but created ${producedPath}${created.ownsPath ? "" : " without owning it"}`,
          );
      } else {
        try {
          await bindPath(producedPath);
        } catch (error) {
          mutateProvisioning(
            deps,
            provisioning,
            ["creating", "ready", "error"],
            (row) => {
              row.teardownStatus = "removed";
              row.claimPath = null;
              row.path = null;
              row.resource = null;
            },
          );
          throw error;
        }
      }
      const producedAdditionalPaths =
        result.additionalPaths === undefined
          ? undefined
          : validateWorkspaceFolderPaths({
              mainPath: producedPath,
              paths: result.additionalPaths,
            });
      const producedReplacedProjectFolders =
        result.replacedProjectFolders === undefined
          ? undefined
          : validateReplacedProjectFolders(result.replacedProjectFolders);
      result = {
        ...result,
        path: producedPath,
        ...(producedAdditionalPaths === undefined
          ? {}
          : { additionalPaths: producedAdditionalPaths }),
        ...(producedReplacedProjectFolders === undefined
          ? {}
          : { replacedProjectFolders: producedReplacedProjectFolders }),
      };
      const produced = result;
      signal.throwIfAborted();
      changed = mutateProvisioning(
        deps,
        provisioning,
        ["creating", "provisioning", "ready", "error"],
        (row) => {
          row.hostId = context.host.id;
          row.path = produced.path;
          row.createPending = false;
          if (!adoptedExistingEnvironment) {
            row.providerOwnsPath = produced.ownsPath;
          }
          if (!adoptedExistingEnvironment || !existingProviderOwnsLifecycle) {
            row.mergeBaseBranch = produced.mergeBaseBranch ?? null;
            row.additionalPaths = produced.additionalPaths ?? [];
            row.replacedProjectFolders = produced.replacedProjectFolders ?? [];
            row.resource = produced.resource ?? null;
          } else {
            if (handedOff) {
              row.resource = produced.resource ?? null;
              row.heldBy = null;
            }
            if (produced.mergeBaseBranch !== undefined)
              row.mergeBaseBranch = produced.mergeBaseBranch;
            if (produced.additionalPaths !== undefined)
              row.additionalPaths = produced.additionalPaths;
            if (produced.replacedProjectFolders !== undefined)
              row.replacedProjectFolders = produced.replacedProjectFolders;
          }
          if (row.status === "creating") row.status = "provisioning";
          if (row.ownerThreadId === null) row.claimPath = null;
        },
      );
      if (setupPath !== null)
        await finishSetupAfterCreate(deps, provisioning.id);
    } else {
      failure = result.message;
    }
  } catch (error) {
    const current = getEnvironment(deps.db, provisioning.id);
    if (
      signal.aborted &&
      current?.attempt === provisioning.attempt &&
      current.teardownStatus === "running"
    ) {
      forgetAdoption();
      return;
    }
    failure = `The "${record.provider.id}" environment provider (plugin "${record.pluginId}") failed: ${errorMessage(error)}`;
  }
  try {
    if (failure !== null) changed = failCreate(deps, provisioning, failure);
  } finally {
    const threadId = context.thread?.id ?? null;
    if (
      threadId !== null &&
      (changed ||
        getPreparingEnvironment(deps.db, threadId)?.status === "ready")
    ) {
      const row = getPreparingEnvironment(deps.db, threadId);
      const startup = getThreadProvisionContext(deps.db, threadId);
      if (
        row !== null &&
        startup !== null &&
        (row.status === "ready" || row.status === "provisioning")
      ) {
        appendThreadProvisioningEvent(deps, {
          threadId,
          environmentId: row.id,
          provisioningId: startup.state.provisioningId,
          status: "active",
          entries: [
            {
              type: "step",
              key: `provider-step-${row.attempt}-${row.statusMessage}`,
              text: row.statusMessage ?? "Creating environment",
              status: "completed",
            },
          ],
        });
        deps.hub.notifyThread(threadId, ["events-appended"], {
          timelineSequence: getLatestThreadSequence(deps.db, {
            threadId,
          }),
          eventTypes: ["system/thread-provisioning"],
        });
      }
      requestEnvironmentProvisioningRecheck(threadId);
    }
    forgetAdoption();
  }
}

async function finishSetupAfterCreate(
  deps: Deps,
  environmentId: string,
): Promise<void> {
  await advanceEnvironmentProvisioning(deps, { environmentId });
}

function failCreate(
  deps: Deps,
  provisioning: EnvironmentRow,
  message: string,
): boolean {
  if (currentProvisioningRow(deps, provisioning, ["ready"])?.createPending)
    applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId: provisioning.id,
      event: { type: "provision.requested" },
    });
  const before = getEnvironment(deps.db, provisioning.id);
  const releaseHold = before !== null && isHandOff(deps, before);
  const changed = mutateProvisioning(
    deps,
    provisioning,
    ["creating", "provisioning"],
    (row) => {
      row.createPending = false;
      row.statusMessage = message;
      if (releaseHold) row.heldBy = null;
      if (row.status === "creating") row.status = "error";
      if (row.ownerThreadId === null) row.claimPath = null;
    },
  );
  const current = getEnvironment(deps.db, provisioning.id);
  if (current?.status !== "provisioning") return changed;
  perDbRegistry(environmentOperations, deps.db)
    .get(current.id)
    ?.controller.abort();
  interruptUnrecoverableEnvironmentProvisioning(deps, {
    environmentId: current.id,
    reason: message,
  });
  return true;
}

export function markProviderEnvironmentAttached(
  db: DbConnection | DbTransaction,
  threadId: string,
  environmentId: string,
): boolean {
  const row = getPreparingEnvironment(db, threadId);
  if (row === null || (row.status !== "provisioning" && row.status !== "ready"))
    return false;
  if (row.id !== environmentId)
    throw new Error("Provisioning must attach its reserved environment");
  return (
    setEnvironmentColumns(db, row.id, {
      ownerThreadId: null,
      claimPath: null,
      retireAt: null,
    }) > 0
  );
}

export async function cancelProviderEnvironmentCreation(
  deps: Deps,
  threadId: string,
): Promise<void> {
  const row = getPreparingEnvironment(deps.db, threadId);
  if (row === null) return;
  if (row.teardownStatus === "removed") {
    if (row.status !== "destroyed")
      writeEnvironment(deps, row.id, { status: "destroyed" });
    return;
  }
  if (row.teardownStatus === null) {
    updatePreparingEnvironment(deps.db, {
      ...row,
      teardownStatus: "running",
      retireAt: Date.now(),
    });
  }
  await sweepProviderEnvironment(deps, row.id);
  let current = getPreparingEnvironment(deps.db, threadId);
  if (current !== null && current.id !== row.id) {
    await sweepProviderEnvironment(deps, current.id);
    current = getPreparingEnvironment(deps.db, threadId);
  }
  if (current !== null && current.teardownStatus !== "removed")
    throw new Error(
      current.teardownMessage ?? "Environment cleanup could not complete",
    );
}

export function requestEnvironmentRemoval(
  deps: Deps,
  environmentId: string,
): boolean {
  const row = getEnvironment(deps.db, environmentId);
  if (row === null) return false;
  const removingMachine = getHost(deps.db, row.hostId)?.phase === "removing";
  if (!removingMachine && environmentHasLiveThreads(deps.db, environmentId))
    return false;
  if (row.ownerThreadId !== null && row.teardownStatus === null) {
    const owner = getThread(deps.db, row.ownerThreadId);
    if (
      !removingMachine &&
      owner !== null &&
      owner.status === "starting" &&
      owner.archivedAt === null &&
      owner.deletedAt === null
    )
      return false;
    updatePreparingEnvironment(deps.db, {
      ...row,
      teardownStatus: "running",
      retireAt: Date.now(),
    });
  }
  if (row.status === "destroyed") return true;
  if (row.environmentProviderId === null) {
    return applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId,
      event: { type: "destroy.recorded" },
    }).applied;
  }
  if (row.teardownStatus === null) {
    setEnvironmentColumns(deps.db, environmentId, {
      retireAt: Date.now(),
      teardownStatus: "running",
    });
    deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
  }
  return true;
}

async function runRemove(
  deps: Deps,
  environmentId: string,
  attempt: number,
  resumeOnly: boolean,
  signal: AbortSignal,
): Promise<void> {
  const row = getEnvironment(deps.db, environmentId);
  if (
    row === null ||
    row.environmentProviderId === null ||
    row.teardownStatus !== "running"
  )
    return;
  const record = getEnvironmentProvider(row.environmentProviderId);
  if (
    record === undefined ||
    record.pluginId !== row.environmentProviderPluginId
  )
    throw new Error(
      `Environment provider "${row.environmentProviderId}" is unavailable or belongs to another plugin`,
    );
  await withHostCleanup(deps, row.hostId, async () => {
    try {
      if (row.providerOwnsPath && row.hostId !== null && row.path !== null) {
        await runEnvironmentTeardownHook(deps, {
          projectId: row.projectId,
          id: `environment:${environmentId}:${row.environmentProviderInstanceKey}:teardown`,
          hostId: row.hostId,
          path: row.path,
          resumeOnly,
          report: {
            step: () => undefined,
            log: (text) =>
              deps.logger.warn(
                { environmentId, text },
                "Environment teardown hook",
              ),
          },
          signal,
        });
      }
      if (row.providerOwnsPath && row.path !== null) {
        await preservePathPluginsInside(deps.db, row.path);
      }
      const invocation = await invokeEnvironmentProvider(
        record,
        "environment remove",
        () =>
          record.provider.remove({
            environment:
              row.ownerThreadId !== null
                ? null
                : toEnvironmentResponse(deps.db, row),
            hostId: row.hostId,
            path: row.path,
            pathKey: row.environmentProviderInstanceKey ?? row.id,
            resource: row.resource,
            attempt,
            report: removalReporter(deps, environmentId),
            signal,
          }),
      );
      if (!invocation.ok) throw new Error(invocation.error);
      if (invocation.value === null)
        throw new Error("The environment provider became unavailable.");
      const result = removeResultSchema.parse(invocation.value);
      if (result.status === "failed") {
        writeEnvironmentTeardownFailure(deps, environmentId, result.message);
        return;
      }
      deps.db.transaction(() => {
        writeEnvironment(deps, environmentId, {
          teardownStatus: "removed",
          teardownMessage: null,
          claimPath: null,
          resource: null,
          retireAt: null,
        });
        applyLoggedEnvironmentLifecycleEvent(deps, {
          environmentId,
          event: { type: "destroy.recorded" },
        });
      });
      emitPluginEnvironmentRemoved({
        environmentId,
        removedAt: Date.now(),
        hostId: row.hostId,
        path: row.path,
        providerOwnedPath: row.providerOwnsPath,
      });
    } catch (error) {
      writeEnvironmentTeardownFailure(deps, environmentId, errorMessage(error));
    }
  });
}

function writeEnvironmentTeardownFailure(
  deps: Pick<Deps, "db" | "hub">,
  environmentId: string,
  message: string,
): void {
  const row = getEnvironment(deps.db, environmentId);
  if (row === null) return;
  const retireAt = nextPersistedRetryAt(
    TEARDOWN_RETRY_DELAYS_MS,
    row.teardownAttempt,
    Date.now(),
  );
  const written = recordEnvironmentTeardownFailure(deps.db, environmentId, {
    teardownMessage:
      retireAt === null
        ? needsRecoveryMessage(
            message,
            `Inspect the workspace, then run bb environment cleanup ${environmentId} --recover.`,
          )
        : message,
    retireAt,
    updatedAt: Date.now(),
  });
  if (written) deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
}

async function removeEnvironment(
  deps: Deps,
  environmentId: string,
): Promise<void> {
  const map = perDbRegistry(environmentOperations, deps.db);
  const creating = perDbRegistry(createOperations, deps.db).get(environmentId);
  if (creating !== undefined) {
    if (getEnvironment(deps.db, environmentId)?.teardownStatus === "running")
      creating.controller.abort();
    await creating.done;
  }
  const active = map.get(environmentId);
  if (active !== undefined) {
    if (
      active.kind === "attach" &&
      getEnvironment(deps.db, environmentId)?.teardownStatus === "running"
    )
      active.controller.abort();
    await active.done;
    if (active.kind === "remove") return;
  }
  const operation = runTrackedOperation({
    kind: "remove",
    map,
    key: environmentId,
    run: (signal) => {
      const row = getEnvironment(deps.db, environmentId);
      return row === null
        ? Promise.resolve()
        : withEnvironmentCleanupSlot(deps.db, row.hostId, () =>
            sweepProviderEnvironmentInSlot(deps, environmentId, signal),
          );
    },
  });
  await operation.done;
}

async function sweepProviderEnvironmentInSlot(
  deps: Deps,
  environmentId: string,
  signal: AbortSignal,
): Promise<void> {
  let row = getEnvironment(deps.db, environmentId);
  if (
    row === null ||
    row.environmentProviderId === null ||
    row.teardownStatus === "removed"
  )
    return;
  const environmentProviderId = row.environmentProviderId;
  const machineRemoving = getHost(deps.db, row.hostId)?.phase === "removing";
  const shared =
    !machineRemoving && environmentHasLiveThreads(deps.db, environmentId);
  if (
    !machineRemoving &&
    row.ownerThreadId !== null &&
    row.teardownStatus !== null &&
    (shared || (row.status === "ready" && row.path !== null))
  ) {
    const released = {
      ownerThreadId: null,
      claimPath: null,
      retireAt: null,
      teardownStatus: null,
    };
    writeEnvironment(deps, environmentId, released);
    row = { ...row, ...released };
  }
  const cancelled = row.ownerThreadId !== null && row.teardownStatus !== null;
  if (!cancelled && row.ownerThreadId !== null) return;
  if (!machineRemoving && row.heldBy !== null && row.teardownStatus === null) {
    if (row.retireAt !== null)
      writeEnvironment(deps, environmentId, { retireAt: null });
    return;
  }
  const record = getEnvironmentProvider(environmentProviderId);
  if (record === undefined) return;
  const now = Date.now();
  if (shared) {
    if (row.teardownStatus === "running" && row.status === "ready")
      writeEnvironment(deps, environmentId, {
        teardownStatus: null,
        retireAt: null,
      });
    else if (row.retireAt !== null && row.teardownStatus === null)
      writeEnvironment(deps, environmentId, { retireAt: null });
    return;
  }
  if (record.pluginId !== row.environmentProviderPluginId) {
    if (row.teardownMessage !== PROVIDER_OWNER_MISMATCH_MESSAGE)
      writeEnvironment(deps, environmentId, {
        teardownStatus: "failed",
        teardownMessage: PROVIDER_OWNER_MISMATCH_MESSAGE,
      });
    return;
  }
  if (persistedRetryExhausted(TEARDOWN_RETRY_DELAYS_MS, row.teardownAttempt)) {
    if (row.teardownStatus !== "failed")
      writeEnvironmentTeardownFailure(
        deps,
        environmentId,
        row.teardownMessage ?? "Cleanup did not complete.",
      );
    else if (row.retireAt !== null)
      writeEnvironment(deps, environmentId, { retireAt: null });
    return;
  }
  if (row.retireAt === null) {
    if (
      !cancelled &&
      record.provider.policy.retireGraceMs === null &&
      row.status !== "destroyed"
    )
      return;
    const retireAt =
      row.status === "destroyed" || cancelled
        ? now
        : now + (record.provider.policy.retireGraceMs ?? 0);
    writeEnvironment(deps, environmentId, { retireAt });
    row = { ...row, retireAt };
  }
  if (row.retireAt !== null && row.retireAt > now) return;
  if (!requestEnvironmentRemoval(deps, environmentId)) return;
  row = getEnvironment(deps.db, environmentId);
  if (row === null || row.teardownStatus === "removed") return;
  if (
    row.teardownStatus === "failed" &&
    row.retireAt !== null &&
    row.retireAt > now
  )
    return;
  const attempt =
    row.teardownStatus === "running" && row.teardownAttempt > 0
      ? row.teardownAttempt
      : row.teardownAttempt + 1;
  writeEnvironment(deps, environmentId, {
    status: row.status === "destroyed" ? "destroyed" : "error",
    teardownStatus: "running",
    teardownAttempt: attempt,
    teardownMessage: null,
  });
  try {
    const setupOperation = readSetupOperation(deps, row);
    const setupUnresolved =
      (setupOperation !== null && setupOperation.finishedAt === null) ||
      cancelled ||
      ((row.status === "provisioning" || row.status === "error") &&
        !hasEnvironmentHookOperation(
          deps.db,
          `environment:${row.id}:${row.environmentProviderInstanceKey}:teardown`,
        ));
    if (
      setupUnresolved &&
      (row.providerOwnsPath || setupOperation !== null) &&
      row.path !== null
    ) {
      await cancelPendingEnvironmentHook(deps, {
        id: setupOperationId(row),
        hostId: row.hostId,
      });
    }
    await runRemove(
      deps,
      environmentId,
      attempt,
      row.teardownAttempt > 0,
      signal,
    );
  } catch (error) {
    writeEnvironmentTeardownFailure(deps, environmentId, errorMessage(error));
  }
}

export function readEnvironmentRecoveryOutcome(
  deps: Pick<Deps, "db">,
  environmentId: string,
): OperationResponse {
  const row = getEnvironment(deps.db, environmentId);
  if (row === null || row.teardownStatus === "removed") {
    return operationComplete();
  }
  if (row.teardownStatus === "failed") {
    throw new ApiError(
      502,
      "environment_teardown_failed",
      row.teardownMessage ?? "Environment cleanup failed",
    );
  }
  return operationInProgress();
}

export function readEnvironmentRemovalProgress(
  deps: Pick<Deps, "db">,
  environmentId: string,
): OperationResponse {
  const row = getEnvironment(deps.db, environmentId);
  return row === null || row.teardownStatus === "removed"
    ? operationComplete()
    : operationInProgress();
}

export function cleanupEnvironment(deps: Deps, environmentId: string): boolean {
  const row = getEnvironment(deps.db, environmentId);
  if (
    row === null ||
    row.environmentProviderId === null ||
    !row.providerOwnsPath ||
    environmentHasLiveThreads(deps.db, environmentId)
  )
    return false;
  if (row.teardownStatus === "removed") return true;
  if (persistedRetryExhausted(TEARDOWN_RETRY_DELAYS_MS, row.teardownAttempt))
    throw new ApiError(
      409,
      "environment_needs_recovery",
      `Needs recovery. Inspect the workspace, then run bb environment cleanup ${environmentId} --recover.`,
    );
  writeEnvironment(deps, environmentId, { retireAt: Date.now() });
  void sweepProviderEnvironment(deps, environmentId).catch((error) => {
    deps.logger.warn(
      { environmentId, error: errorMessage(error) },
      "Environment removal will retry",
    );
  });
  return true;
}

export async function recoverEnvironmentCleanup(
  deps: Deps,
  environmentId: string,
): Promise<void> {
  const map = perDbRegistry(environmentOperations, deps.db);
  if (map.has(environmentId))
    throw new ApiError(
      409,
      "invalid_request",
      "Environment cleanup is still running",
    );
  await runTrackedOperation({
    kind: "remove",
    map,
    key: environmentId,
    run: async (signal) => {
      const row = getEnvironment(deps.db, environmentId);
      if (
        row === null ||
        row.environmentProviderId === null ||
        row.teardownStatus !== "failed" ||
        environmentHasLiveThreads(deps.db, environmentId)
      )
        throw new ApiError(
          409,
          "invalid_request",
          "Recovery requires a failed, unused provider-managed environment",
        );
      const workspacePath = row.providerOwnsPath ? row.path : null;
      await withEnvironmentCleanupSlot(deps.db, row.hostId, async () => {
        if (workspacePath !== null) {
          const inspection = await callHostOnlineRpc(deps, {
            hostId: row.hostId,
            timeoutMs: 30_000,
            command: {
              type: "environment.inspect_cleanup",
              environmentId,
              path: workspacePath,
            },
          });
          if (
            !inspection.supported ||
            inspection.active ||
            inspection.pids.length > 0 ||
            inspection.unreadablePids.length > 0
          )
            throw new ApiError(
              409,
              "invalid_request",
              `Recovery refused: ${!inspection.supported ? "process inspection is unavailable on this host (supported on Linux and macOS)" : inspection.active ? "setup or a hook is still running" : inspection.pids.length > 0 ? `workspace processes remain (${inspection.pids.join(", ")})` : `cannot inspect same-user processes (${inspection.unreadablePids.join(", ")})`}`,
            );
        }
        const current = getEnvironment(deps.db, environmentId);
        if (
          current === null ||
          current.path !== row.path ||
          current.environmentProviderInstanceKey !==
            row.environmentProviderInstanceKey ||
          current.teardownStatus !== "failed" ||
          environmentHasLiveThreads(deps.db, environmentId)
        )
          throw new ApiError(
            409,
            "invalid_request",
            "Environment changed during recovery inspection; inspect it again",
          );
        deps.db.transaction(() => {
          if (workspacePath !== null)
            for (const kind of ["setup", "teardown"] as const) {
              const id = `environment:${row.id}:${row.environmentProviderInstanceKey}:${kind}`;
              const finishedAt = Date.now();
              if (
                kind === "teardown" &&
                !hasEnvironmentHookOperation(deps.db, id)
              )
                continue;
              acknowledgeInterruptedEnvironmentHookOperation(deps.db, {
                id,
                hostId: row.hostId,
                path: workspacePath,
                kind,
                finishedAt,
                error:
                  "Interrupted hook acknowledged by explicit cleanup recovery",
              });
            }
          writeEnvironment(deps, environmentId, {
            teardownAttempt: 0,
            retireAt: Date.now(),
            teardownMessage: null,
          });
        });
        await sweepProviderEnvironmentInSlot(deps, environmentId, signal);
      });
    },
  }).done;
}

export function providerLifecycleSweep(
  deps: Deps,
  options?: { background: true },
): ItemSweep {
  return defineItemSweep({
    name: "environment-provider-lifecycle",
    concurrency: Number.POSITIVE_INFINITY,
    list: () =>
      listEnvironmentProviders().flatMap((record) =>
        listProviderLifecycleEnvironments(deps.db, record.provider.id, {
          pluginId: record.pluginId,
          teardownMessage: PROVIDER_OWNER_MISMATCH_MESSAGE,
        }),
      ),
    key: (row) => row.id,
    process: (row) => {
      const removal = sweepProviderEnvironment(deps, row.id).catch((error) => {
        deps.logger.warn(
          { environmentId: row.id, error: errorMessage(error) },
          "Environment removal will retry",
        );
      });
      if (options?.background !== true) return removal;
    },
  });
}

export async function sweepProviderLifecycles(deps: Deps): Promise<void> {
  await providerLifecycleSweep(deps).run(deps, Date.now());
  releaseFinishedEnvironmentPreparationOwners(deps.db);
}

export function providerEnvironmentHasPendingWork(
  db: DbConnection | DbTransaction,
  threadId: string,
): boolean {
  const row = getPreparingEnvironment(db, threadId);
  if (row === null) return false;
  return row.teardownStatus !== "removed";
}

export function releasePluginEnvironmentHolds(
  deps: {
    db: DbConnection | DbTransaction;
    hub: Pick<Deps["hub"], "notifyEnvironment">;
  },
  pluginId: string,
): void {
  for (const environmentId of releaseEnvironmentHolds(
    deps.db,
    `plugin:${pluginId}`,
  )) {
    deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
    refreshProviderRetirement(deps, environmentId);
  }
}

export function refreshProviderRetirement(
  deps: {
    db: DbConnection | DbTransaction;
    hub: Pick<Deps["hub"], "notifyEnvironment">;
  },
  environmentId: string,
): void {
  const row = getEnvironment(deps.db, environmentId);
  if (
    row === null ||
    row.environmentProviderId === null ||
    row.teardownStatus !== null
  )
    return;
  const provider = getEnvironmentProvider(row.environmentProviderId);
  if (provider === undefined) return;
  const grace = provider.provider.policy.retireGraceMs;
  const retireAt =
    grace === null ||
    row.heldBy !== null ||
    environmentHasLiveThreads(deps.db, environmentId)
      ? null
      : (row.retireAt ?? Date.now() + grace);
  if (row.retireAt === retireAt) return;
  setEnvironmentColumns(deps.db, environmentId, { retireAt });
  deps.hub.notifyEnvironment(environmentId, ["metadata-changed"]);
}

type EnvironmentProvisionCommand =
  HostDaemonCommandForType<"environment.attach">;
type EnvironmentProvisionCommandResultReport =
  CommandResultReportForType<"environment.attach">;
type EnvironmentProvisionCancelCommand =
  HostDaemonCommandForType<"environment.attach.cancel">;
type EnvironmentProvisionCancelCommandResultReport =
  CommandResultReportForType<"environment.attach.cancel">;

interface EnvironmentProvisionReadDeps {
  db: DbQueryConnection;
}

interface EnvironmentProvisionWriteDeps extends EnvironmentProvisionReadDeps {
  db: DbConnection | DbTransaction;
  hub: DbNotifier;
}

interface EnvironmentProvisionTransactionDeps extends EnvironmentProvisionWriteDeps {
  db: DbTransaction;
  logger: AppDeps["logger"];
  pendingInteractions: AppDeps["pendingInteractions"];
}

interface AdvanceEnvironmentProvisioningArgs {
  removal?: boolean;
  threadId?: string;
  creation?: {
    record: PluginEnvironmentProviderRecord;
    context?: ProviderOperationContext;
  };
  environmentId: string | null | undefined;
  request?: EnvironmentProvisionRequest | null;
  setupRunsOnConnectedDaemon?: boolean;
}

interface SettleEnvironmentProvisionCommandResultArgs {
  command: EnvironmentProvisionCommand;
  deps: EnvironmentProvisionTransactionDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: EnvironmentProvisionCommandResultReport;
}

interface SettleEnvironmentProvisionCancelCommandResultArgs {
  command: EnvironmentProvisionCancelCommand;
  deps: EnvironmentProvisionTransactionDeps;
  execution: HostDaemonCommandExecutionRecord;
  report: EnvironmentProvisionCancelCommandResultReport;
}

interface FailEnvironmentProvisioningDurablyArgs {
  environmentId: string;
  failureEntry: ProvisioningTranscriptEntry;
  failureReason: string;
  provisioningId: string;
}

interface StartTrackedEnvironmentProvisionCommandArgs {
  environment: EnvironmentRow;
  request: EnvironmentProvisionRequest;
  setupRunsOnConnectedDaemon: boolean;
}

interface SettleEnvironmentProvisionOutcomeArgs extends SettleEnvironmentProvisionCommandResultArgs {
  headSha: string | null;
  initiatorStreamed: boolean;
  mergeBaseBranch: string | null;
}

interface InterruptUnrecoverableEnvironmentProvisioningArgs {
  environmentId: string;
  reason: string;
}

interface InterruptEnvironmentProvisioningForHostArgs {
  hostId: string;
  reason: string;
}

interface LiveEnvironmentThread {
  environmentId: string | null;
  id: string;
  status: ThreadStatus;
}

interface StopRequestedEnvironmentProvisionThread {
  id: string;
  status: ThreadStatus;
}

interface AppendThreadProvisioningEventToEnvironmentThreadsArgs {
  entries: ProvisioningTranscriptEntry[];
  environmentId: string;
  fallbackProvisioningId: string;
  status: SystemThreadProvisioningStatus;
  threads?: LiveEnvironmentThread[];
}

function listLiveEnvironmentThreads(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
): LiveEnvironmentThread[] {
  return listUndeletedEnvironmentThreads(deps.db, environmentId);
}

function listStopRequestedEnvironmentProvisionThreads(
  deps: EnvironmentProvisionReadDeps,
  environmentId: string,
): StopRequestedEnvironmentProvisionThread[] {
  return listStoppingLiveEnvironmentThreads(deps.db, environmentId);
}

function resolveLiveThreadProvisioningId(
  deps: EnvironmentProvisionReadDeps,
  thread: LiveEnvironmentThread,
  fallbackProvisioningId: string,
): string {
  const context = getThreadProvisionContext(deps.db, thread.id);
  if (context?.state.environmentId === thread.environmentId) {
    return context.state.provisioningId;
  }
  return fallbackProvisioningId;
}

function appendThreadProvisioningEventToEnvironmentThreadsInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: AppendThreadProvisioningEventToEnvironmentThreadsArgs,
): void {
  const liveThreads =
    args.threads ?? listLiveEnvironmentThreads(deps, args.environmentId);

  for (const thread of liveThreads) {
    const provisioningId = resolveLiveThreadProvisioningId(
      deps,
      thread,
      args.fallbackProvisioningId,
    );
    appendThreadProvisioningEventInTransaction(deps.db, {
      entries: args.entries,
      environmentId: args.environmentId,
      provisioningId,
      status: args.status,
      threadId: thread.id,
    });
    deps.hub.notifyThread(thread.id, ["events-appended"], {
      timelineSequence: getLatestThreadSequence(deps.db, {
        threadId: thread.id,
      }),
      eventTypes: ["system/thread-provisioning"],
    });
  }
}

function hasActiveThreadProvisioningContext(
  deps: EnvironmentProvisionReadDeps,
  thread: LiveEnvironmentThread,
): boolean {
  const context = getThreadProvisionContext(deps.db, thread.id);
  return context?.state.environmentId === thread.environmentId;
}

function shouldPreserveThreadProvisionCancellationOutcome(
  deps: EnvironmentProvisionReadDeps,
  args: { provisioningId: string; thread: LiveEnvironmentThread },
): boolean {
  if (args.thread.status === "stopping") return true;
  return hasStoredCancelledThreadProvisioning(deps.db, {
    environmentId: args.thread.environmentId,
    provisioningId: args.provisioningId,
    threadId: args.thread.id,
  });
}

function recordEnvironmentProvisioningFailureInTransaction(
  deps: EnvironmentProvisionTransactionDeps,
  args: FailEnvironmentProvisioningDurablyArgs,
): ThreadLifecycleOutcome[] {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment) {
    return [];
  }
  const liveThreads = listLiveEnvironmentThreads(deps, environment.id);
  const failureThreads = liveThreads.filter(
    (thread) =>
      !shouldPreserveThreadProvisionCancellationOutcome(deps, {
        provisioningId: args.provisioningId,
        thread,
      }),
  );
  if (failureThreads.length === 0 && liveThreads.length > 0) {
    if (environment.status === "destroyed") return [];
    const outcome = applyLoggedEnvironmentLifecycleEventInTransaction(deps, {
      environmentId: environment.id,
      event: { type: "provision.cancelled" },
    });
    if (outcome.applied)
      deps.hub.notifyEnvironment(environment.id, outcome.changes);
    return [];
  }

  const failureOutcome = applyLoggedEnvironmentLifecycleEventInTransaction(
    deps,
    {
      environmentId: environment.id,
      event: { type: "provision.failed" },
    },
  );
  if (failureOutcome.applied) {
    setEnvironmentColumns(deps.db, environment.id, {
      statusMessage: args.failureReason,
    });
    deps.hub.notifyEnvironment(environment.id, failureOutcome.changes);
  }

  appendThreadProvisioningEventToEnvironmentThreadsInTransaction(deps, {
    environmentId: environment.id,
    fallbackProvisioningId: args.provisioningId,
    status: "failed",
    threads: failureThreads,
    entries: [args.failureEntry],
  });

  const failed: ThreadLifecycleOutcome[] = [];
  for (const thread of failureThreads) {
    clearThreadProvisionSchedule(thread.id);
    appendSystemErrorEventInTransaction(deps, {
      threadId: thread.id,
      environmentId: environment.id,
      code: "thread_provisioning_failed",
      message: "Provisioning thread failed",
      detail: args.failureReason,
      scope: threadScope(),
    });
    const outcome = runThreadLifecycleInTransaction(deps, thread.id, {
      type: "provisioning.failed",
    });
    if (outcome.statusChanged) {
      failed.push(outcome);
    }
  }

  return failed;
}

export function settleEnvironmentProvisionCommandResult(
  args: SettleEnvironmentProvisionCommandResultArgs,
): CommandResultSideEffectsResult {
  return settleEnvironmentProvisionOutcome({
    ...args,
    headSha: null,
    initiatorStreamed: true,
    mergeBaseBranch:
      getEnvironment(args.deps.db, args.command.environmentId)
        ?.mergeBaseBranch ?? null,
  });
}

function settleEnvironmentProvisionOutcome(
  args: SettleEnvironmentProvisionOutcomeArgs,
): CommandResultSideEffectsResult {
  const postCommitActions: CommandResultPostCommitAction[] = [];
  const initiator = args.command.initiator;
  const boundThreads = listEnvironmentThreads(
    args.deps.db,
    args.command.environmentId,
  );

  if (args.report.ok) {
    recordProvisionedEnvironmentWorkspace(
      args.deps.db,
      args.deps.hub,
      args.command.environmentId,
      {
        path: args.report.result.path,
        isGitRepo: args.report.result.isGitRepo,
        isWorktree: args.report.result.isWorktree,
        branchName: args.report.result.branchName,
        defaultBranch: args.report.result.defaultBranch,
        ...(args.mergeBaseBranch === null
          ? {}
          : { baseBranch: null, mergeBaseBranch: args.mergeBaseBranch }),
      },
    );
    const provisionedOutcome =
      applyLoggedEnvironmentLifecycleEventInTransaction(args.deps, {
        environmentId: args.command.environmentId,
        event: { type: "provision.succeeded" },
      });
    if (provisionedOutcome.applied) {
      args.deps.hub.notifyEnvironment(
        args.command.environmentId,
        provisionedOutcome.changes,
      );
    }
    args.deps.hub.notifyEnvironment(args.command.environmentId, [
      "work-status-changed",
    ]);
    if (!initiator) {
      return { postCommitActions: advanceJoinedThreads(args, boundThreads) };
    }
    const environmentProvisioningId = initiator.provisioningId;

    const cwdBranchEntries = buildCwdBranchEntries({
      path: args.report.result.path,
      branchName: args.report.result.branchName,
      headSha: args.headSha,
    });

    for (const thread of boundThreads) {
      if (thread.deletedAt !== null) {
        postCommitActions.push(
          finalizeStoppedThreadPostCommit(
            finalizeStoppedThreadInTransaction(args.deps, {
              fence: false,
              threadId: thread.id,
            }),
          ),
        );
        continue;
      }
      if (
        thread.archivedAt !== null ||
        shouldPreserveThreadProvisionCancellationOutcome(args.deps, {
          provisioningId: environmentProvisioningId,
          thread,
        })
      ) {
        continue;
      }

      const entries =
        thread.id === initiator.threadId && args.initiatorStreamed
          ? []
          : cwdBranchEntries;

      if (!hasActiveThreadProvisioningContext(args.deps, thread)) {
        appendThreadProvisioningEventInTransaction(args.deps.db, {
          threadId: thread.id,
          environmentId: args.command.environmentId,
          provisioningId: environmentProvisioningId,
          status: thread.status === "starting" ? "active" : "completed",
          entries,
        });
        args.deps.hub.notifyThread(thread.id, ["events-appended"], {
          timelineSequence: getLatestThreadSequence(args.deps.db, {
            threadId: thread.id,
          }),
          eventTypes: ["system/thread-provisioning"],
        });
        continue;
      }

      ensureWorkspaceReadyEventInTransaction(args.deps, {
        threadId: thread.id,
        environmentId: args.command.environmentId,
        entries,
      });
      postCommitActions.push({
        run: (deps) => advanceThreadProvisioning(deps, { threadId: thread.id }),
      });
    }

    return { postCommitActions };
  }

  const failed = recordEnvironmentProvisioningFailureInTransaction(args.deps, {
    environmentId: args.command.environmentId,
    failureReason: args.report.errorMessage,
    provisioningId:
      initiator?.provisioningId ?? `env-${args.command.environmentId}-setup`,
    failureEntry: {
      type: "step",
      key: "workspace-failed",
      text: "Workspace setup failed",
      status: "failed",
      startedAt: args.execution.createdAt,
      metadata: { durationMs: Date.now() - args.execution.createdAt },
    },
  });
  for (const outcome of failed) {
    postCommitActions.push({
      run: async (deps) => {
        await finishThreadLifecycle(deps, outcome);
        const thread = getThread(deps.db, outcome.threadId);
        if (thread && thread.deletedAt === null)
          queueChildSetupFailureNotification(deps, thread);
      },
    });
  }
  return { postCommitActions };
}

function advanceJoinedThreads(
  args: SettleEnvironmentProvisionOutcomeArgs,
  boundThreads: ReturnType<typeof listEnvironmentThreads>,
): CommandResultPostCommitAction[] {
  if (!args.report.ok) return [];
  const entries = buildCwdBranchEntries({
    path: args.report.result.path,
    branchName: args.report.result.branchName,
    headSha: args.headSha,
  });
  return boundThreads
    .filter(
      (thread) =>
        thread.deletedAt === null &&
        thread.archivedAt === null &&
        thread.status === "starting" &&
        hasActiveThreadProvisioningContext(args.deps, thread),
    )
    .map((thread) => {
      ensureWorkspaceReadyEventInTransaction(args.deps, {
        threadId: thread.id,
        environmentId: args.command.environmentId,
        entries,
      });
      return {
        run: (deps: CommandResultSideEffectsDeps) =>
          advanceThreadProvisioning(deps, { threadId: thread.id }),
      };
    });
}

export function settleEnvironmentProvisionCancelCommandResult(
  args: SettleEnvironmentProvisionCancelCommandResultArgs,
): CommandResultSideEffectsResult {
  const stoppedThreads = listStopRequestedEnvironmentProvisionThreads(
    args.deps,
    args.command.environmentId,
  );
  if (!args.report.ok) {
    const environment = getEnvironment(
      args.deps.db,
      args.command.environmentId,
    );
    args.deps.logger.warn(
      {
        activeProvisionState:
          environment?.status === "provisioning" ? "provisioning" : null,
        executionId: args.execution.id,
        environmentId: args.command.environmentId,
        errorCode: args.report.errorCode,
        errorMessage: args.report.errorMessage,
        stoppedThreadCount: stoppedThreads.length,
        stoppedThreadIds: stoppedThreads.map((thread) => thread.id),
      },
      "Environment provision cancel command failed",
    );

    if (!environment || stoppedThreads.length === 0) {
      return emptyCommandResultSideEffects();
    }

    return {
      postCommitActions: [
        {
          run: (deps) => {
            for (const thread of stoppedThreads) {
              requestThreadStopForCurrentState(deps, thread);
            }
          },
        },
      ],
    };
  }

  const postCommitActions: CommandResultPostCommitAction[] = [];
  const cancelledOutcome = applyLoggedEnvironmentLifecycleEventInTransaction(
    args.deps,
    {
      environmentId: args.command.environmentId,
      event: { type: "provision.cancelled" },
    },
  );
  if (cancelledOutcome.applied) {
    args.deps.hub.notifyEnvironment(
      args.command.environmentId,
      cancelledOutcome.changes,
    );
  }

  for (const thread of stoppedThreads) {
    postCommitActions.push(
      finalizeStoppedThreadPostCommit(
        finalizeStoppedThreadInTransaction(args.deps, {
          fence: true,
          threadId: thread.id,
        }),
      ),
    );
  }

  return { postCommitActions };
}

function interruptUnrecoverableEnvironmentProvisioning(
  deps: CommandResultSideEffectsDeps,
  args: InterruptUnrecoverableEnvironmentProvisioningArgs,
): void {
  const environment = getEnvironment(deps.db, args.environmentId);
  if (!environment || environment.status !== "provisioning") {
    return;
  }

  const now = Date.now();
  const failed = deps.db.transaction(
    (tx) => {
      return recordEnvironmentProvisioningFailureInTransaction(
        {
          ...deps,
          db: tx,
        },
        {
          environmentId: environment.id,
          failureReason: args.reason,
          provisioningId: `env-${environment.id}-interrupted`,
          failureEntry: {
            type: "step",
            key: "workspace-failed",
            text: "Workspace setup interrupted",
            status: "failed",
            startedAt: now,
            metadata: { durationMs: 0 },
          },
        },
      );
    },
    { behavior: "immediate" },
  );
  for (const outcome of failed) {
    finishThreadLifecycleInBackground(deps, outcome);
    const thread = getThread(deps.db, outcome.threadId);
    if (thread && thread.deletedAt === null)
      queueChildSetupFailureNotification(deps, thread);
  }
}

export function interruptEnvironmentProvisioningForHost(
  deps: CommandResultSideEffectsDeps,
  args: InterruptEnvironmentProvisioningForHostArgs,
): void {
  for (const environmentId of listProvisioningEnvironmentIdsOnHost(
    deps.db,
    args.hostId,
  )) {
    interruptUnrecoverableEnvironmentProvisioning(deps, {
      environmentId,
      reason: args.reason,
    });
  }
}

export async function resumeEnvironmentProvisioningForHost(
  deps: CommandResultSideEffectsDeps,
  args: { hostId: string },
): Promise<void> {
  await resumeHostEnvironmentProvisioning(deps, {
    hostId: args.hostId,
    setupRunsOnConnectedDaemon: false,
  });
}

export async function resumeEnvironmentProvisioningForReconnectedDaemon(
  deps: CommandResultSideEffectsDeps,
  args: { hostId: string },
): Promise<void> {
  await resumeHostEnvironmentProvisioning(deps, {
    hostId: args.hostId,
    setupRunsOnConnectedDaemon: true,
  });
}

async function resumeHostEnvironmentProvisioning(
  deps: CommandResultSideEffectsDeps,
  args: { hostId: string; setupRunsOnConnectedDaemon: boolean },
): Promise<void> {
  for (const environmentId of listProvisioningEnvironmentIdsOnHost(
    deps.db,
    args.hostId,
  )) {
    await advanceEnvironmentProvisioning(deps, {
      environmentId,
      setupRunsOnConnectedDaemon: args.setupRunsOnConnectedDaemon,
    });
  }
}

export async function runTrackedEnvironmentAttach(
  deps: CommandResultSideEffectsDeps,
  args: {
    hostId: string;
    command: EnvironmentProvisionRequest["command"];
    timeoutMs: number;
  },
): Promise<void> {
  const operation = runTrackedOperation({
    kind: "attach",
    map: perDbRegistry(environmentOperations, deps.db),
    key: args.command.environmentId,
    run: async () => {
      await runLiveHostCommand(deps, args);
    },
  });
  await operation.done;
}

const SETUP_TRANSCRIPT_BATCH_MS = 1_000;

function setupOperationId(environment: EnvironmentRow): string {
  return `environment:${environment.id}:${environment.environmentProviderInstanceKey}:setup`;
}

function readSetupOperation(
  deps: Pick<Deps, "db">,
  environment: EnvironmentRow,
) {
  return getEnvironmentHookOperation(deps.db, setupOperationId(environment));
}

async function createReturned(
  deps: Pick<Deps, "db">,
  environmentId: string,
  signal: AbortSignal,
): Promise<boolean> {
  const aborted = new Promise<void>((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
  for (;;) {
    const row = getEnvironment(deps.db, environmentId);
    if (signal.aborted || row === null) return false;
    if (!row.createPending) return row.status === "provisioning";
    const create = perDbRegistry(createOperations, deps.db).get(environmentId);
    if (create === undefined) return false;
    await Promise.race([create.done.catch(() => {}), aborted]);
  }
}

function setupSucceededAt(
  deps: Pick<Deps, "db">,
  environment: EnvironmentRow,
  path: string,
): boolean {
  const operation = readSetupOperation(deps, environment);
  return (
    operation !== null &&
    operation.finishedAt !== null &&
    operation.error === null &&
    areHostPathsEqual(operation.path, path)
  );
}

function createSetupTranscript(
  deps: CommandResultSideEffectsDeps,
  args: {
    environmentId: string;
    initiator: EnvironmentProvisionRequest["command"]["initiator"];
  },
): { push: EnvironmentHookProgressSink; flush: () => void } {
  const initiator = args.initiator;
  const pending: ProvisioningTranscriptEntry[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (initiator === null || pending.length === 0) return;
    const entries = pending.splice(0, pending.length);
    const thread = getThread(deps.db, initiator.threadId);
    if (thread === null || thread.deletedAt !== null) return;
    appendThreadProvisioningEvent(deps, {
      threadId: initiator.threadId,
      environmentId: args.environmentId,
      provisioningId: initiator.provisioningId,
      status: "active",
      entries,
    });
  };
  return {
    push: (entry) => {
      if (initiator === null) return;
      pending.push(entry);
      if (timer === null) {
        timer = setTimeout(flush, SETUP_TRANSCRIPT_BATCH_MS);
        timer.unref?.();
      }
    },
    flush,
  };
}

function provisionCancelledError(): ApiError {
  return new ApiError(
    409,
    "provision_cancelled",
    "Environment provisioning was cancelled",
  );
}

async function runEnvironmentSetup(
  deps: CommandResultSideEffectsDeps,
  args: StartTrackedEnvironmentProvisionCommandArgs & {
    signal: AbortSignal;
  },
): Promise<"ready" | "stopped" | { failed: Error }> {
  const environment = args.environment;
  const id = setupOperationId(environment);
  const unknownOutcomeReason = `An earlier setup has an unknown outcome. Archive its threads, inspect the workspace, then run bb environment cleanup ${environment.id} --recover.`;
  const existing = readSetupOperation(deps, environment);
  if (
    existing !== null &&
    existing.finishedAt === null &&
    !args.setupRunsOnConnectedDaemon
  ) {
    interruptUnrecoverableEnvironmentProvisioning(deps, {
      environmentId: environment.id,
      reason: unknownOutcomeReason,
    });
    return "stopped";
  }
  const transcript = createSetupTranscript(deps, {
    environmentId: environment.id,
    initiator: args.request.command.initiator,
  });
  try {
    await runEnvironmentHook(deps, {
      id,
      projectId: environment.projectId,
      hostId: environment.hostId,
      path: args.request.command.path,
      kind: "setup",
      resumeOnly: false,
      onProgress: transcript.push,
      signal: args.signal,
    });
    return args.signal.aborted
      ? { failed: provisionCancelledError() }
      : "ready";
  } catch (error) {
    if (args.signal.aborted) return { failed: provisionCancelledError() };
    if (error instanceof Error && isHostUnavailableApiError(error)) {
      deps.logger.info(
        {
          environmentId: environment.id,
          hostId: environment.hostId,
        },
        "Environment provisioning waiting for host reconnect",
      );
      return "stopped";
    }
    if (isEnvironmentHookOutcomeUnknown(error)) {
      interruptUnrecoverableEnvironmentProvisioning(deps, {
        environmentId: environment.id,
        reason: unknownOutcomeReason,
      });
      return "stopped";
    }
    return {
      failed: error instanceof Error ? error : new Error(String(error)),
    };
  } finally {
    transcript.flush();
  }
}

function logEnvironmentProvisionFailure(
  deps: CommandResultSideEffectsDeps,
  args: StartTrackedEnvironmentProvisionCommandArgs & {
    error: unknown;
    executionId: string;
  },
): void {
  const expectedErrorFields =
    args.error instanceof Error
      ? expectedLiveHostCommandErrorLogFields(args.error)
      : null;
  if (expectedErrorFields !== null) {
    deps.logger.debug(
      {
        commandType: args.request.command.type,
        environmentId: args.environment.id,
        ...expectedErrorFields,
        executionId: args.executionId,
        hostId: args.environment.hostId,
        initiatorThreadId: args.request.command.initiator?.threadId ?? null,
        provisioningId: args.request.command.initiator?.provisioningId ?? null,
      },
      "Live environment provisioning cancelled",
    );
    return;
  }
  deps.logger.warn(
    {
      commandType: args.request.command.type,
      err: args.error,
      environmentId: args.environment.id,
      executionId: args.executionId,
      hostId: args.environment.hostId,
    },
    "Live environment provision command failed",
  );
}

async function runEnvironmentProvisionCommand(
  deps: CommandResultSideEffectsDeps,
  args: StartTrackedEnvironmentProvisionCommandArgs & { signal: AbortSignal },
): Promise<void> {
  const execution = createLiveHostCommandExecution(args.environment.hostId);
  const current = getEnvironment(deps.db, args.environment.id);
  if (
    args.environment.providerOwnsPath &&
    !(
      current?.createPending === true &&
      !isHandOff(deps, current) &&
      setupSucceededAt(deps, args.environment, args.request.command.path)
    )
  ) {
    const setup = await runEnvironmentSetup(deps, args);
    if (setup === "stopped") return;
    if (setup !== "ready") {
      logEnvironmentProvisionFailure(deps, {
        ...args,
        error: setup.failed,
        executionId: execution.id,
      });
      await settleLiveHostCommandFailure(deps, {
        command: args.request.command,
        execution,
        error: setup.failed,
      });
      return;
    }
  }
  if (!(await createReturned(deps, args.environment.id, args.signal))) return;
  await runLiveHostCommand(deps, {
    command: args.request.command,
    execution,
    hostId: args.environment.hostId,
    preserveOnHostUnavailable: true,
    timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
  }).catch((error) => {
    if (error instanceof Error && isHostUnavailableApiError(error)) {
      deps.logger.info(
        {
          commandType: args.request.command.type,
          environmentId: args.environment.id,
          executionId: execution.id,
          hostId: args.environment.hostId,
        },
        "Environment provisioning waiting for host reconnect",
      );
      return;
    }
    logEnvironmentProvisionFailure(deps, {
      ...args,
      error,
      executionId: execution.id,
    });
  });
}

function startingThreadOf(
  deps: Pick<Deps, "db">,
  environmentId: string,
): ReturnType<typeof getStartingLiveEnvironmentThread> {
  return getStartingLiveEnvironmentThread(deps.db, environmentId);
}

function recoverEnvironmentProvisionRequest(
  deps: CommandResultSideEffectsDeps,
  environment: EnvironmentRow,
): EnvironmentProvisionRequest | null {
  if (environment.path === null) return null;
  const path = environment.path;
  const command = (initiator: EnvironmentProvisionCommand["initiator"]) => ({
    command: buildEnvironmentProvisionCommand({
      environmentId: environment.id,
      hostId: environment.hostId,
      initiator,
      path,
    }),
  });
  for (const ownerId of listStartingLiveEnvironmentThreadIds(
    deps.db,
    environment.id,
  )) {
    const context = getThreadProvisionContext(deps.db, ownerId);
    if (context?.state.environmentId !== environment.id) continue;
    return command({
      threadId: ownerId,
      provisioningId: context.state.provisioningId,
    });
  }
  return environment.heldBy !== null && environment.ownerThreadId === null
    ? command(null)
    : null;
}

function handOffThreadId(
  deps: Pick<Deps, "db">,
  environment: EnvironmentRow,
): string | null {
  if (!environment.heldBy?.startsWith("plugin:")) return null;
  return (
    environment.ownerThreadId ??
    startingThreadOf(deps, environment.id)?.id ??
    null
  );
}

function isHandOff(
  deps: Pick<Deps, "db">,
  environment: EnvironmentRow,
): boolean {
  return handOffThreadId(deps, environment) !== null;
}

function isInterruptedHandOff(
  deps: Pick<Deps, "db">,
  environment: EnvironmentRow,
  createMap: Map<string, ActiveOperation>,
): boolean {
  return (
    isHandOff(deps, environment) &&
    environment.createPending &&
    environment.teardownStatus === null &&
    !createMap.has(environment.id)
  );
}

async function restartInterruptedHandOff(
  deps: Deps,
  environment: EnvironmentRow,
): Promise<void> {
  const threadId = handOffThreadId(deps, environment);
  const selection = environment.environmentProviderSelection;
  const notifications = new NotificationBuffer();
  const discarded = deps.db.transaction(
    (tx) => {
      const current = getEnvironment(tx, environment.id);
      if (
        current === null ||
        current.heldBy !== environment.heldBy ||
        current.teardownStatus !== null ||
        !current.createPending
      )
        return false;
      setEnvironmentColumns(tx, environment.id, {
        heldBy: null,
        createPending: false,
        ownerThreadId: null,
        claimPath: null,
        teardownStatus: "running",
        retireAt: Date.now(),
        updatedAt: Date.now(),
      });
      notifications.notifyEnvironment(environment.id, ["metadata-changed"]);
      if (threadId === null || selection === null) return true;
      const context = getThreadProvisionContext(tx, threadId);
      if (context === null) return true;
      updateThread(tx, notifications, threadId, { environmentId: null });
      context.request.environmentIntent = {
        type: "provider",
        environmentProviderId: environment.environmentProviderId!,
        machine: selection.machine,
        inputs: selection.inputs,
        selectionResolved: true,
      };
      context.state.environmentId = null;
      saveThreadProvisionContext({ replace: false, db: tx, threadId, context });
      return true;
    },
    { behavior: "immediate" },
  );
  notifications.flushInto(deps.hub);
  if (!discarded) return;
  deps.logger.info(
    { environmentId: environment.id, threadId },
    "Discarded an environment whose handoff was interrupted; the thread gets a new one",
  );
  if (threadId !== null) requestEnvironmentProvisioningRecheck(threadId);
  await sweepProviderEnvironment(deps, environment.id);
}

export async function advanceEnvironmentProvisioning(
  deps: CommandResultSideEffectsDeps,
  args: AdvanceEnvironmentProvisioningArgs,
): Promise<void> {
  if (!args.environmentId) return;
  let environment = getEnvironment(deps.db, args.environmentId);
  if (environment === null) return;
  const map = perDbRegistry(environmentOperations, deps.db);
  if (
    args.threadId !== undefined &&
    environment.ownerThreadId !== null &&
    environment.ownerThreadId !== args.threadId
  )
    assertEnvironmentPathAvailable(deps, {
      ...environment,
      threadId: args.threadId,
    });
  if (
    args.removal ||
    (environment.teardownStatus !== null &&
      environment.teardownStatus !== "removed")
  ) {
    await removeEnvironment(deps, environment.id);
    return;
  }
  if (
    environment.status === "provisioning" &&
    listStopRequestedEnvironmentProvisionThreads(deps, environment.id).length >
      0 &&
    !listLiveEnvironmentThreads(deps, environment.id).some(
      (thread) => thread.status === "starting",
    )
  ) {
    const row = environment;
    const cancel = () =>
      runLiveHostCommand(deps, {
        command: { type: "environment.attach.cancel", environmentId: row.id },
        hostId: row.hostId,
        timeoutMs: LIVE_DAEMON_COMMAND_TIMEOUT_MS,
      })
        .then(() => {})
        .catch((error) =>
          deps.logger.warn(
            { environmentId: row.id, error },
            "Environment cancellation failed",
          ),
        );
    const active = map.get(row.id);
    if (active?.kind === "attach") active.controller.abort();
    if (active !== undefined) active.cancellation ??= cancel();
    else runTrackedOperation({ kind: "attach", map, key: row.id, run: cancel });
    return;
  }
  if (environment.status === "destroyed") return;
  const createMap = perDbRegistry(createOperations, deps.db);
  if (environment.status === "creating" && createMap.has(environment.id))
    return;
  if (isInterruptedHandOff(deps, environment, createMap)) {
    await restartInterruptedHandOff(deps, environment);
    return;
  }
  if (environment.status === "ready" && environment.createPending) return;
  if (
    environment.status === "creating" ||
    (environment.createPending &&
      environment.status === "provisioning" &&
      !createMap.has(environment.id))
  ) {
    const owner =
      environment.ownerThreadId === null
        ? null
        : getThread(deps.db, environment.ownerThreadId);
    const context =
      owner === null ? null : getThreadProvisionContext(deps.db, owner.id);
    const record =
      args.creation?.record ??
      (environment.environmentProviderId === null
        ? undefined
        : getEnvironmentProvider(environment.environmentProviderId));
    if (record === undefined) return;
    const row = environment;
    const operation = runTrackedOperation({
      kind: "create",
      map: createMap,
      key: row.id,
      run: async (signal) => {
        let creation: ProviderOperationContext | null;
        try {
          creation =
            args.creation?.context ??
            (owner !== null &&
            context?.request.environmentIntent.type === "provider"
              ? await resolveProviderOperationContext(
                  deps,
                  owner,
                  context.request.environmentIntent,
                  record,
                )
              : row.ownerThreadId === null
                ? resolveHeldEnvironmentOperationContext(
                    deps,
                    row,
                    record,
                    startingThreadOf(deps, row.id),
                  )
                : null);
        } catch (error) {
          failCreate(deps, row, errorMessage(error));
          if (row.ownerThreadId !== null)
            requestEnvironmentProvisioningRecheck(row.ownerThreadId);
          return;
        }
        if (creation === null) {
          if (row.status !== "creating")
            failCreate(
              deps,
              row,
              "The environment's create could not be resumed",
            );
          return;
        }
        await runCreate(deps, record, row, creation, signal);
      },
    });
    void operation.done
      .then(async () => {
        const current =
          row.ownerThreadId === null
            ? getEnvironment(deps.db, row.id)
            : getPreparingEnvironment(deps.db, row.ownerThreadId);
        if (current !== null && current.status !== "creating")
          await advanceEnvironmentProvisioning(deps, {
            environmentId: current.id,
          });
      })
      .catch((error) =>
        deps.logger.warn(
          { environmentId: row.id, error },
          "Environment advancement failed",
        ),
      );
    if (environment.status === "creating") return;
  }
  if (environment.status === "error") {
    if (
      environment.ownerThreadId !== null ||
      args.threadId === undefined ||
      getThread(deps.db, args.threadId)?.status !== "starting"
    )
      return;
    const outcome = applyLoggedEnvironmentLifecycleEvent(deps, {
      environmentId: environment.id,
      event: { type: "provision.requested" },
    });
    if (!outcome.applied) return;
    writeEnvironment(deps, environment.id, {
      attempt: environment.attempt + 1,
      statusMessage: "Retrying workspace setup",
    });
    environment = getEnvironment(deps.db, environment.id)!;
  }
  const threadId = environment.ownerThreadId ?? args.threadId;
  if (threadId !== undefined && threadId !== null) {
    const context = getThreadProvisionContext(deps.db, threadId);
    if (context === null) return;
    const target = environment;
    const preparation =
      target.ownerThreadId === null
        ? getPreparingEnvironment(deps.db, threadId)
        : target;
    const needsAttachment =
      target.ownerThreadId !== null ||
      preparation?.status === "provisioning" ||
      preparation?.status === "ready" ||
      context.state.environmentId !== target.id ||
      context.request.environmentIntent.type !== "reuse" ||
      context.request.environmentIntent.environmentId !== target.id ||
      getThread(deps.db, threadId)?.environmentId !== target.id;
    if (
      target.status === "ready" &&
      target.ownerThreadId !== null &&
      target.path !== null
    )
      await refreshAttachedEnvironmentBranch(deps, {
        environmentId: target.id,
        hostId: target.hostId,
        path: target.path,
      });
    assertEnvironmentPathAvailable(deps, { ...target, threadId });
    if (needsAttachment) {
      deps.db.transaction(
        (tx) => {
          if (
            getThreadProvisionContext(tx, threadId)?.state.provisioningId !==
            context.state.provisioningId
          )
            return;
          updateThread(tx, deps.hub, threadId, { environmentId: target.id });
          if (markProviderEnvironmentAttached(tx, threadId, target.id))
            deps.hub.notifyEnvironment(target.id, ["metadata-changed"]);
          context.request.environmentIntent = {
            type: "reuse",
            environmentId: target.id,
          };
          context.state.environmentId = target.id;
          saveThreadProvisionContext({
            replace: false,
            db: tx,
            threadId,
            context,
          });
        },
        { behavior: "immediate" },
      );
      environment = getEnvironment(deps.db, environment.id);
      if (environment === null || environment.ownerThreadId !== null) return;
    }
  }
  if (environment.status === "ready") {
    if (threadId != null && args.threadId === undefined)
      void advanceThreadProvisioning(deps, { threadId });
    return;
  }
  if (
    environment.status !== "provisioning" ||
    map.has(environment.id) ||
    findHostDataDir(deps, environment.hostId) === null
  )
    return;
  const request =
    args.request ?? recoverEnvironmentProvisionRequest(deps, environment);
  if (request === null) {
    interruptUnrecoverableEnvironmentProvisioning(deps, {
      environmentId: environment.id,
      reason:
        "Environment setup did not finish. Retry provisioning to continue.",
    });
    return;
  }
  const row = environment;
  runTrackedOperation({
    kind: "attach",
    map,
    key: row.id,
    run: (signal) =>
      runEnvironmentProvisionCommand(deps, {
        environment: row,
        request,
        setupRunsOnConnectedDaemon: args.setupRunsOnConnectedDaemon === true,
        signal,
      }),
  });
}

export async function forgetHostEnvironments(
  deps: Deps,
  hostId: string,
): Promise<void> {
  const map = perDbRegistry(environmentOperations, deps.db);
  const listRows = () => listHostEnvironmentRemovalStates(deps.db, hostId);
  const createMap = perDbRegistry(createOperations, deps.db);
  await Promise.all(
    listRows().flatMap((row) =>
      [map.get(row.id), createMap.get(row.id)].flatMap(
        (operation) => operation?.done.catch(() => {}) ?? [],
      ),
    ),
  );
  const pending = listRows().filter(
    (row) => row.status !== "destroyed" || row.teardownStatus !== "removed",
  );
  markHostEnvironmentsDestroyed(deps.db, deps.hub, hostId);
  const removedAt = Date.now();
  for (const row of pending) {
    emitPluginEnvironmentRemoved({
      environmentId: row.id,
      removedAt,
      hostId,
      path: row.path,
      providerOwnedPath: row.providerOwnsPath,
    });
  }
}

export async function sweepProviderEnvironment(
  deps: Deps,
  environmentId: string,
): Promise<void> {
  await advanceEnvironmentProvisioning(deps, { environmentId, removal: true });
}
