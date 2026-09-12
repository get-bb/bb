import {
  getAppSettings,
  getEnvironment,
  getNonDestroyedHostByLaunchKey,
  getThread,
  projectSourceOwnsPath,
  recordEnvironmentCurrentBranch,
  type DbConnection,
} from "@bb/db";
import {
  type Environment,
  type ProjectSource,
  type ProvisioningTranscriptEntry,
  type Thread,
} from "@bb/domain";
import { type ThreadProvisionContext } from "./thread-startup-store.js";
import { type ThreadProvisioningDeps } from "./thread-provisioning-environment.js";
import { buildSuggestedBranchName } from "./thread-create-helpers.js";
import { toThreadResponseFromThread } from "./thread-runtime-display.js";
import { toEnvironmentResponse } from "../environments/environment-response.js";
import {
  advanceEnvironmentProvisioning,
  cancelProviderEnvironmentCreation,
  type ProviderOperationContext,
} from "../environments/environment-engine.js";
import {
  getPreparingEnvironment,
  reserveEnvironment,
  updatePreparingEnvironment,
} from "@bb/db";
import { appendThreadProvisioningEvent } from "./thread-events.js";
import { scheduleEnvironmentProvisioning } from "./thread-environment-providers.js";
import {
  getThreadProvisionContext,
  saveThreadProvisionContext,
} from "./thread-startup-store.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { getProjectSourceByHost, type EnvironmentRow } from "@bb/db";
import { z } from "zod";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "../environments/environment-provider-ids.js";
import {
  jsonValueSchema,
  PERSONAL_PROJECT_ID,
  isLocalPathProjectSource,
  type EnvironmentMachineSelection,
  type GitBranchSelection,
  type JsonValue,
} from "@bb/domain";
import type {
  EnvironmentArgs,
  ProviderEnvironmentArgs,
  UnmanagedBranchSpec,
} from "@bb/server-contract";
import { summarizeStandardIssues } from "@get-bb/plugin-sdk/internal/host-policy";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import {
  environmentProviderDecisionTimeoutMs,
  getEnvironmentProvider,
  listEnvironmentCompositions,
  invokeEnvironmentProvider,
  type PluginEnvironmentProviderRecord,
} from "../plugins/plugin-environment-provider-registry.js";
import {
  getMachineProvider,
  type PluginMachineProviderRecord,
} from "../plugins/plugin-machine-provider-registry.js";
import {
  askMachineLaunch,
  prepareMachineProviderSelection,
} from "../machines/provider-orchestration.js";
import { ensureProjectSourceOnHost } from "../projects/project-source-setup.js";
import { requireSourceForHost } from "./thread-create-helpers.js";
import { foreignProviderOwnedPathRefusal } from "./workspace-path-claims.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";
import {
  getNonDestroyedHostWithStatus,
  requireNonDestroyedHostWithStatus,
  requirePublicProject,
} from "../lib/entity-lookup.js";
import { decideWithinBox } from "./dispatch-hooks.js";
import { throwEnvironmentNotReady } from "../lib/lifecycle-api-errors.js";
import {
  resolveGitCheckoutAvailability,
  resolvePluginEnvironmentProviderAvailability,
} from "../environments/provider-availability.js";
import { resolveStableThreadRequestEnvironment } from "./thread-request-eligibility.js";
import type { ThreadProvisionEnvironmentIntent } from "./thread-startup-store.js";

type PlacementDeps = LoggedPendingInteractionWorkSessionDeps;

export function worktreeProviderInputs(branch: GitBranchSelection): JsonValue {
  return { branch };
}

export function checkoutProviderInputs(
  path: string,
  branch: UnmanagedBranchSpec | undefined,
): JsonValue {
  return { path, ...(branch === undefined ? {} : { branch }) };
}

export interface ThreadEnvironmentPlacement {
  environmentId: string | null;
  environmentIntent: ThreadProvisionEnvironmentIntent;
}

type ProviderSelection = Pick<
  Extract<ThreadProvisionEnvironmentIntent, { type: "provider" }>,
  "machine" | "inputs"
>;

interface ResolvedProviderSelection extends ProviderSelection {
  selectionResolved: boolean;
}

function refuseProviderSelection(
  environmentProviderId: string,
  detail: string,
): never {
  throw new ApiError(
    400,
    "invalid_request",
    `The "${environmentProviderId}" environment provider ${detail}`,
  );
}

function toProviderProjectCheckout(
  db: DbConnection,
  args: { checkout: ProjectSource | null; hostId: string; projectId: string },
): ProviderOperationContext["projectCheckout"] {
  return args.checkout !== null && isLocalPathProjectSource(args.checkout)
    ? {
        path: args.checkout.path,
        experimental_ownsPath: projectSourceOwnsPath(
          db,
          args.projectId,
          args.hostId,
          args.checkout.path,
        ),
      }
    : null;
}

export async function parseProviderInputs(
  record: PluginEnvironmentProviderRecord,
  inputs: JsonValue | null,
): Promise<JsonValue | null> {
  const environmentProviderId = record.provider.id;
  const schema = record.provider.inputs;
  if (schema === null) {
    if (inputs !== null) {
      refuseProviderSelection(
        environmentProviderId,
        "takes no inputs, but the request carried some",
      );
    }
    return null;
  }
  if (inputs === null) {
    refuseProviderSelection(
      environmentProviderId,
      "needs inputs, and the request carried none",
    );
  }
  const invocation = await invokeEnvironmentProvider(
    record,
    `"${environmentProviderId}" environment provider inputs`,
    async () => schema["~standard"].validate(inputs),
  );
  if (!invocation.ok) {
    throw new ApiError(
      502,
      "environment_provider_failed",
      `The "${environmentProviderId}" environment provider (plugin "${record.pluginId}") failed to validate its inputs: ${invocation.error}`,
      { details: { environmentProviderId, pluginId: record.pluginId } },
    );
  }
  const parsed = invocation.value;
  if (parsed.issues !== undefined) {
    refuseProviderSelection(
      environmentProviderId,
      `refused the inputs: ${summarizeStandardIssues(parsed.issues)}`,
    );
  }
  const value = jsonValueSchema.safeParse(parsed.value);
  if (!value.success) {
    throw new ApiError(
      502,
      "environment_provider_failed",
      `The "${environmentProviderId}" environment provider (plugin "${record.pluginId}") parsed its inputs into a value that is not JSON`,
      { details: { environmentProviderId, pluginId: record.pluginId } },
    );
  }
  return value.data;
}

export function requireEnvironmentPlacementHost(
  deps: PlacementDeps,
  hostId: string,
) {
  const host = requireNonDestroyedHostWithStatus(deps, hostId);
  if (host.lifecycle.phase === "removing") {
    throw new ApiError(
      409,
      "machine_removing",
      "Machine is being removed and cannot accept new environments",
    );
  }
  return host;
}

export async function completeProviderSelection(
  deps: PlacementDeps,
  record: PluginEnvironmentProviderRecord,
  projectId: string,
  selection: ProviderSelection,
): Promise<ProviderSelection> {
  const environmentProviderId = record.provider.id;
  const requires = record.provider.requires;
  let machine: EnvironmentMachineSelection;
  if (selection.machine.type === "existing") {
    requireEnvironmentPlacementHost(deps, selection.machine.hostId);
    if (requires.projectCheckout) {
      requireSourceForHost(deps, projectId, selection.machine.hostId);
    }
    machine = selection.machine;
  } else {
    const prepared = await prepareMachineProviderSelection(deps, {
      machineProviderId: selection.machine.machineProviderId,
      inputs: selection.machine.inputs,
    });
    machine = { ...selection.machine, inputs: prepared.inputs };
  }
  if (requires.projectless && projectId !== PERSONAL_PROJECT_ID) {
    refuseProviderSelection(
      environmentProviderId,
      "serves only threads that have no project",
    );
  }
  if (!requires.projectless && projectId === PERSONAL_PROJECT_ID) {
    refuseProviderSelection(
      environmentProviderId,
      "does not serve projectless threads",
    );
  }
  const inputs = await parseProviderInputs(record, selection.inputs);
  if (machine.type === "existing") {
    await validateProviderSelection(deps, record, {
      hostId: machine.hostId,
      inputs,
      projectId,
    });
  }
  return { machine, inputs };
}

async function resolveCompleteProviderSelection(
  deps: PlacementDeps,
  projectId: string,
  environmentProviderId: string,
  selection: ProviderSelection,
): Promise<ResolvedProviderSelection> {
  const record = getEnvironmentProvider(environmentProviderId);
  if (record === undefined) {
    return { ...selection, selectionResolved: false };
  }
  const completed = await completeProviderSelection(
    deps,
    record,
    projectId,
    selection,
  );
  return { ...completed, selectionResolved: true };
}

const VALIDATE_DECISION_SHAPE =
  '{ action: "accept" } or { action: "refuse", message }';

const VALIDATE_REFUSAL_MAX_LENGTH = 500;

const validateDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({
    action: z.literal("refuse"),
    message: z.string().min(1).max(VALIDATE_REFUSAL_MAX_LENGTH),
  }),
]);

export async function validateProviderSelection(
  deps: PlacementDeps,
  record: PluginEnvironmentProviderRecord,
  args: { hostId: string; inputs: JsonValue | null; projectId: string },
): Promise<void> {
  const environmentProviderId = record.provider.id;
  const requires = record.provider.requires;
  const project = requirePublicProject(deps.db, args.projectId);
  const host = getNonDestroyedHostWithStatus(deps, args.hostId);
  if (host === null) {
    refuseProviderSelection(
      environmentProviderId,
      "runs on a machine that no longer exists",
    );
  }
  const checkout =
    host === null
      ? null
      : getProjectSourceByHost(deps.db, args.projectId, host.id);
  const projectCheckout = toProviderProjectCheckout(deps.db, {
    checkout,
    hostId: host.id,
    projectId: project.id,
  });
  if (requires.gitRemote && project.gitRemoteUrl === null) {
    throw new ApiError(
      409,
      "environment_provider_rejected",
      `${project.name} has no git remote, so the "${environmentProviderId}" environment provider has nothing to clone.`,
      { details: { environmentProviderId } },
    );
  }
  if (requires.gitCheckout && projectCheckout !== null) {
    const availability = await resolveGitCheckoutAvailability(deps, {
      hostId: host.id,
      path: projectCheckout.path,
    });
    if (availability.status !== "available") {
      throw new ApiError(
        409,
        "environment_provider_rejected",
        availability.message,
        { details: { environmentProviderId } },
      );
    }
  }
  const availability = await resolvePluginEnvironmentProviderAvailability(
    record,
    {
      project,
      host,
      projectCheckout,
      gitRemote: project.gitRemoteUrl,
    },
  );
  if (!availability.ok) {
    throw new ApiError(
      502,
      "environment_provider_failed",
      availability.message,
      { details: { environmentProviderId, pluginId: record.pluginId } },
    );
  }
  if (availability.availability.status !== "available") {
    throw new ApiError(
      409,
      "environment_provider_rejected",
      availability.availability.message,
      {
        details: {
          environmentProviderId,
          pluginId: record.pluginId,
          availabilityStatus: availability.availability.status,
        },
      },
    );
  }
  const validate = record.provider.validate;
  if (validate === null) {
    return;
  }
  const invocation = await invokeEnvironmentProvider(
    record,
    `"${environmentProviderId}" environment provider validate`,
    () =>
      decideWithinBox(
        () =>
          Promise.resolve(
            validate({
              project,
              host,
              projectCheckout,
              gitRemote: requires.gitRemote ? project.gitRemoteUrl : null,
              inputs: args.inputs,
            }),
          ),
        environmentProviderDecisionTimeoutMs(),
      ),
  );
  const failure = !invocation.ok
    ? invocation.error
    : invocation.value.ok
      ? null
      : invocation.value.error;
  if (failure !== null) {
    throw new ApiError(
      502,
      "environment_provider_failed",
      `The "${environmentProviderId}" environment provider (plugin "${record.pluginId}") failed to validate the request: ${failure}`,
      { details: { environmentProviderId, pluginId: record.pluginId } },
    );
  }
  if (!invocation.ok || !invocation.value.ok) {
    return;
  }
  const parsed = validateDecisionSchema.safeParse(invocation.value.value);
  if (!parsed.success) {
    throw new ApiError(
      502,
      "environment_provider_failed",
      `The "${environmentProviderId}" environment provider (plugin "${record.pluginId}") returned an invalid validate decision: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}. A decision is ${VALIDATE_DECISION_SHAPE}`,
      { details: { environmentProviderId, pluginId: record.pluginId } },
    );
  }
  if (parsed.data.action === "refuse") {
    throw new ApiError(
      409,
      "environment_provider_rejected",
      parsed.data.message,
      { details: { environmentProviderId } },
    );
  }
}

export interface ResolveThreadEnvironmentPlacementArgs {
  allowUnmanagedPersonalProjectReuseEnvironmentId?: string;
  projectId: string;
  requestedEnvironment: EnvironmentArgs | ProviderEnvironmentArgs;
}

function reuseEnvironmentPlacement(
  deps: PlacementDeps,
  environment: EnvironmentRow,
): ThreadEnvironmentPlacement {
  if (
    environment.teardownStatus !== null ||
    (environment.status !== "ready" && environment.status !== "provisioning")
  ) {
    throwEnvironmentNotReady(environment);
  }
  if (environment.status === "ready" && !environment.path) {
    throwEnvironmentNotReady(environment);
  }
  if (environment.status === "provisioning") {
    requireNonDestroyedHostWithStatus(deps, environment.hostId);
  }
  return {
    environmentId: environment.id,
    environmentIntent: { type: "reuse", environmentId: environment.id },
  };
}

export async function resolveThreadEnvironmentPlacement(
  deps: PlacementDeps,
  args: ResolveThreadEnvironmentPlacementArgs,
): Promise<ThreadEnvironmentPlacement> {
  if (args.requestedEnvironment.type === "provider") {
    const requested = args.requestedEnvironment;
    const composition = listEnvironmentCompositions().find(
      (record) => record.composition.id === requested.environmentProviderId,
    )?.composition;
    const environmentProviderId =
      composition?.environmentProviderId ?? requested.environmentProviderId;
    if (
      composition &&
      requested.machine !== undefined &&
      (requested.machine.type !== "new" ||
        requested.machine.machineProviderId !== composition.machineProviderId)
    ) {
      refuseProviderSelection(
        requested.environmentProviderId,
        `creates a new machine with provider "${composition.machineProviderId}"; machine must select that provider`,
      );
    }
    const machine = composition
      ? (requested.machine ?? {
          type: "new" as const,
          machineProviderId: composition.machineProviderId,
          inputs: null,
        })
      : requested.machine;
    if (machine === undefined)
      refuseProviderSelection(
        environmentProviderId,
        "requires a machine selection",
      );
    if (composition) {
      const target = getEnvironmentProvider(environmentProviderId);
      if (!target)
        refuseProviderSelection(
          requested.environmentProviderId,
          "requires an environment provider that is not registered",
        );
      if (
        (target.provider.requires.projectCheckout ||
          target.provider.requires.gitRemote) &&
        requirePublicProject(deps.db, args.projectId).gitRemoteUrl === null
      )
        refuseProviderSelection(
          requested.environmentProviderId,
          "requires a project with a Git remote",
        );
    }
    return providerPlacement(deps, args.projectId, environmentProviderId, {
      machine,
      inputs: requested.inputs,
    });
  }
  const resolvedEnvironment = resolveStableThreadRequestEnvironment(deps, {
    ...(args.allowUnmanagedPersonalProjectReuseEnvironmentId !== undefined
      ? {
          allowUnmanagedPersonalProjectReuseEnvironmentId:
            args.allowUnmanagedPersonalProjectReuseEnvironmentId,
        }
      : {}),
    environment: args.requestedEnvironment,
    projectId: args.projectId,
  });
  switch (resolvedEnvironment.type) {
    case "reuse":
      return reuseEnvironmentPlacement(deps, resolvedEnvironment.environment);
    case "host": {
      const workspace = resolvedEnvironment.workspace;
      if (workspace.type !== "unmanaged") {
        return providerPlacement(
          deps,
          args.projectId,
          DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
          {
            machine: {
              type: "existing",
              hostId: resolvedEnvironment.hostId,
            },
            inputs: worktreeProviderInputs(workspace.baseBranch),
          },
        );
      }
      if (resolvedEnvironment.unmanagedPath === null) {
        throw new Error(
          "Validated unmanaged host request is missing a workspace path",
        );
      }
      const dataDir = (
        await ensureHostSessionReadyForWork(deps, {
          hostId: resolvedEnvironment.hostId,
        })
      ).dataDir;
      const refusal = foreignProviderOwnedPathRefusal(deps.db, {
        dataDir,
        hostId: resolvedEnvironment.hostId,
        path: resolvedEnvironment.unmanagedPath,
        projectId: args.projectId,
      });
      if (refusal !== null) {
        throw new ApiError(409, "invalid_request", refusal);
      }
      return providerPlacement(
        deps,
        args.projectId,
        DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
        {
          machine: {
            type: "existing",
            hostId: resolvedEnvironment.hostId,
          },
          inputs: checkoutProviderInputs(
            resolvedEnvironment.unmanagedPath,
            workspace.branch,
          ),
        },
      );
    }
    case "personal": {
      return providerPlacement(
        deps,
        args.projectId,
        DEFAULT_ENVIRONMENT_PROVIDER_ID.personalWorkspace,
        {
          machine: {
            type: "existing",
            hostId: resolvedEnvironment.hostId,
          },
          inputs: null,
        },
      );
    }
  }
}
export async function resolveProviderOperationContext(
  deps: ThreadProvisioningDeps,
  thread: Thread,
  intent: Extract<
    import("./thread-startup-store.js").ThreadProvisionEnvironmentIntent,
    { type: "provider" }
  >,
  record: NonNullable<ReturnType<typeof getEnvironmentProvider>>,
): Promise<ProviderOperationContext | null> {
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
  const machineDecision =
    selection.machine.type === "new"
      ? askMachineLaunch(deps, {
          key: thread.id,
          lifetime: "thread",
          record: requireRegisteredMachineProvider(
            intent.environmentProviderId,
            record.pluginId,
            selection.machine.machineProviderId,
          ),
          inputs: selection.machine.inputs,
        })
      : null;
  const hostId =
    selection.machine.type === "existing"
      ? selection.machine.hostId
      : getNonDestroyedHostByLaunchKey(deps.db, thread.id)?.id;
  const host =
    hostId === undefined ? null : getNonDestroyedHostWithStatus(deps, hostId);
  if (host === null) {
    throw providerFailure(
      intent.environmentProviderId,
      record.pluginId,
      "runs on a machine that no longer exists",
    );
  }
  if (machineDecision?.action === "reject") {
    reportMachineProgress(deps, thread.id, {
      step: null,
      log: machineFailureLog(machineDecision.log, machineDecision.message),
      failed: true,
    });
    failPreparingEnvironment(deps, thread.id, machineDecision.message);
    throw new ApiError(
      409,
      "machine_provider_rejected",
      machineDecision.message,
    );
  }
  if (machineDecision?.action === "wait") {
    reportMachineProgress(deps, thread.id, {
      step: machineDecision.reason,
      log: machineDecision.log,
    });
    updatePreparingEnvironmentProgress(deps, thread.id, {
      statusMessage: machineDecision.reason,
    });
    scheduleEnvironmentProvisioning(deps, thread.id, machineDecision.sendAt);
    return null;
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
  let checkout = getProjectSourceByHost(deps.db, thread.projectId, host.id);
  if (
    selection.machine.type === "new" &&
    requires.projectCheckout &&
    checkout === null
  ) {
    reportMachineProgress(deps, thread.id, {
      step: "Setting up project on machine",
      log: machineDecision?.log ?? "",
    });
    updatePreparingEnvironmentProgress(deps, thread.id, {
      statusMessage: "Setting up project on machine",
    });
    checkout = await ensureProjectSourceOnHost(deps, {
      projectId: project.id,
      projectName: project.name,
      hostId: host.id,
      remoteUrl: project.gitRemoteUrl,
    });
  }
  const projectCheckout = toProviderProjectCheckout(deps.db, {
    checkout,
    hostId: host.id,
    projectId: project.id,
  });
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
  return buildProviderOperationContext(deps, {
    host,
    inputs: selection.inputs,
    machine: selection.machine,
    project,
    projectCheckout,
    record,
    thread,
  });
}

function buildProviderOperationContext(
  deps: ThreadProvisioningDeps,
  args: Pick<
    ProviderOperationContext,
    "host" | "inputs" | "machine" | "project" | "projectCheckout"
  > & { record: PluginEnvironmentProviderRecord; thread: Thread },
): ProviderOperationContext {
  return {
    thread: toThreadResponseFromThread(deps, { thread: args.thread }),
    project: args.project,
    host: args.host,
    machine: args.machine,
    projectCheckout: args.projectCheckout,
    gitRemote: args.record.provider.requires.gitRemote
      ? args.project.gitRemoteUrl
      : null,
    inputs: args.inputs,
    suggestedBranchName: buildSuggestedBranchName({
      branchPrefix: getAppSettings(deps.db).managedBranchPrefix,
      title: args.thread.title ?? args.thread.titleFallback,
      threadId: args.thread.id,
    }),
    environment: threadProvisionContextEnvironment(
      deps,
      args.thread.environmentId,
    ),
  };
}

function requireRegisteredMachineProvider(
  environmentProviderId: string,
  pluginId: string | null,
  machineProviderId: string,
): PluginMachineProviderRecord {
  const machineRecord = getMachineProvider(machineProviderId);
  if (machineRecord === undefined) {
    throw providerFailure(
      environmentProviderId,
      pluginId,
      `needs the "${machineProviderId}" machine provider, which is not registered`,
    );
  }
  return machineRecord;
}

function machineFailureLog(log: string, message: string): string {
  const trimmedLog = log.trimEnd();
  if (trimmedLog.length === 0 || message.includes(trimmedLog)) {
    return `${message}\n`;
  }
  if (trimmedLog.includes(message)) return `${trimmedLog}\n`;
  return `${trimmedLog}\n${message}\n`;
}

function reportMachineProgress(
  deps: ThreadProvisioningDeps,
  threadId: string,
  args: { step: string | null; log: string; failed?: boolean },
): void {
  const startup = getThreadProvisionContext(deps.db, threadId);
  if (startup === null) return;
  const row = getPreparingEnvironment(deps.db, threadId);
  const attempt = row?.attempt ?? 0;
  const previous = row?.statusMessage ?? null;
  const entries: ProvisioningTranscriptEntry[] = [];
  if (args.step !== null && args.step !== previous) {
    if (previous !== null)
      entries.push({
        type: "step",
        key: `provider-step-${attempt}-${previous}`,
        text: previous,
        status: "completed",
      });
    entries.push({
      type: "step",
      key: `provider-step-${attempt}-${args.step}`,
      text: args.step,
      status: "started",
    });
  }
  if (args.log.length > 0)
    entries.push({
      type: "output",
      key: `provider-output-${attempt}-${Date.now()}`,
      text: args.log,
    });
  if (args.failed && previous !== null)
    entries.push({
      type: "step",
      key: `provider-step-${attempt}-${previous}`,
      text: previous,
      status: "failed",
    });
  if (entries.length === 0) return;
  appendThreadProvisioningEvent(deps, {
    threadId,
    environmentId: row?.id ?? null,
    provisioningId: startup.state.provisioningId,
    status: "active",
    entries,
  });
  deps.hub.notifyThread(threadId, ["events-appended"], {
    eventTypes: ["system/thread-provisioning"],
  });
}

function updatePreparingEnvironmentProgress(
  deps: ThreadProvisioningDeps,
  threadId: string,
  change: { statusMessage: string },
): void {
  const row = getPreparingEnvironment(deps.db, threadId);
  if (row === null || row.status !== "creating") return;
  if (row.statusMessage === change.statusMessage) return;
  if (
    updatePreparingEnvironment(deps.db, {
      ...row,
      statusMessage: change.statusMessage,
    })
  )
    deps.hub.notifyEnvironment(row.id, ["metadata-changed"]);
}

function failPreparingEnvironment(
  deps: ThreadProvisioningDeps,
  threadId: string,
  statusMessage: string,
): void {
  const row = getPreparingEnvironment(deps.db, threadId);
  if (row === null || row.status !== "creating") return;
  if (
    updatePreparingEnvironment(deps.db, {
      ...row,
      status: "error",
      statusMessage,
    })
  )
    deps.hub.notifyEnvironment(row.id, ["metadata-changed"]);
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
export async function refreshAttachedEnvironmentBranch(
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

async function reserveEnvironmentBeforeMachine(
  deps: ThreadProvisioningDeps,
  args: {
    context: ThreadProvisionContext;
    intent: Extract<ThreadProvisionEnvironmentIntent, { type: "provider" }>;
    record: PluginEnvironmentProviderRecord;
    thread: Thread;
  },
): Promise<ProviderEnvironmentCreationDecision> {
  const selection = args.intent.selectionResolved
    ? { machine: args.intent.machine, inputs: args.intent.inputs }
    : await completeProviderSelection(
        deps,
        args.record,
        args.thread.projectId,
        args.intent,
      );
  if (selection.machine.type !== "new")
    throw new Error("Expected a new machine selection");
  const machineRecord = requireRegisteredMachineProvider(
    args.intent.environmentProviderId,
    args.record.pluginId,
    selection.machine.machineProviderId,
  );
  const machineDecision = askMachineLaunch(deps, {
    key: args.thread.id,
    lifetime: "thread",
    record: machineRecord,
    inputs: selection.machine.inputs,
  });
  const hostRow = getNonDestroyedHostByLaunchKey(deps.db, args.thread.id);
  if (hostRow === null)
    throw new ApiError(
      409,
      "machine_provider_rejected",
      machineDecision.action === "reject"
        ? machineDecision.message
        : "Machine was removed",
    );
  const host = getNonDestroyedHostWithStatus(deps, hostRow.id);
  if (host === null)
    throw new ApiError(409, "machine_provider_rejected", "Machine was removed");
  args.intent.machine = selection.machine;
  args.intent.inputs = selection.inputs;
  args.intent.selectionResolved = true;
  saveThreadProvisionContext({
    db: deps.db,
    replace: false,
    threadId: args.thread.id,
    context: args.context,
  });
  const project = requirePublicProject(deps.db, args.thread.projectId);
  const context = buildProviderOperationContext(deps, {
    host,
    inputs: selection.inputs,
    machine: selection.machine,
    project,
    projectCheckout: null,
    record: args.record,
    thread: args.thread,
  });
  const statusMessage =
    machineDecision.action === "ready"
      ? "Setting up project on machine"
      : machineDecision.action === "wait"
        ? machineDecision.reason
        : machineDecision.message;
  const decision = prepareProviderEnvironment(deps, args.record, context, {
    advance: machineDecision.action !== "reject",
    contextReady: false,
    statusMessage,
  });
  if (machineDecision.action === "reject") {
    reportMachineProgress(deps, args.thread.id, {
      step: null,
      log: machineFailureLog(machineDecision.log, machineDecision.message),
      failed: true,
    });
    failPreparingEnvironment(deps, args.thread.id, machineDecision.message);
  } else if (machineDecision.log.length > 0)
    reportMachineProgress(deps, args.thread.id, {
      step: null,
      log: machineDecision.log,
    });
  return decision;
}

export async function resolveEnvironmentProvider(
  deps: ThreadProvisioningDeps,
  args: { context: ThreadProvisionContext; thread: Thread },
): Promise<
  { kind: "resolved"; environment: EnvironmentRow } | { kind: "waiting" }
> {
  const context = args.context;
  const thread = getThread(deps.db, args.thread.id);
  if (thread === null || thread.status !== "starting")
    return { kind: "waiting" };
  const intent = context.request.environmentIntent;
  if (intent.type !== "provider")
    throw new Error("Missing environment provider selection");
  const record = getEnvironmentProvider(intent.environmentProviderId);
  if (record === undefined) {
    scheduleEnvironmentProvisioning(deps, thread.id, Date.now() + 30_000);
    return { kind: "waiting" };
  }
  if (
    intent.machine.type === "new" &&
    getPreparingEnvironment(deps.db, thread.id) === null
  ) {
    const decision = await reserveEnvironmentBeforeMachine(deps, {
      context,
      intent,
      record,
      thread,
    });
    if (decision.action === "reject")
      throw new ApiError(
        409,
        "environment_provider_rejected",
        decision.message,
        { details: { environmentProviderId: intent.environmentProviderId } },
      );
    scheduleEnvironmentProvisioning(
      deps,
      thread.id,
      decision.action === "wait" ? decision.sendAt : Date.now(),
    );
    return { kind: "waiting" };
  }
  const operation = await resolveProviderOperationContext(
    deps,
    thread,
    intent,
    record,
  );
  if (operation === null) return { kind: "waiting" };
  const current = getThreadProvisionContext(deps.db, thread.id);
  if (
    current === null ||
    current.state.provisioningId !== context.state.provisioningId
  )
    return { kind: "waiting" };
  if (current.request.environmentIntent.type === "reuse") {
    const environment = getEnvironment(
      deps.db,
      current.request.environmentIntent.environmentId,
    );
    return environment === null
      ? { kind: "waiting" }
      : { kind: "resolved", environment };
  }
  saveThreadProvisionContext({
    db: deps.db,
    replace: false,
    threadId: thread.id,
    context,
  });
  const decision = prepareProviderEnvironment(deps, record, operation);
  if (decision.action === "reject")
    throw new ApiError(409, "environment_provider_rejected", decision.message, {
      details: { environmentProviderId: intent.environmentProviderId },
    });
  if (decision.action === "wait") {
    scheduleEnvironmentProvisioning(deps, thread.id, decision.sendAt);
    return { kind: "waiting" };
  }
  const environment = decision.environment;
  return { kind: "resolved", environment };
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

export type ProviderEnvironmentCreationDecision =
  | { action: "wait"; reason: string; sendAt: number }
  | { action: "reject"; message: string }
  | {
      action: "ready";
      environment: EnvironmentRow;
    };

export function prepareProviderEnvironment(
  deps: ThreadProvisioningDeps,
  record: PluginEnvironmentProviderRecord,
  context: ProviderOperationContext,
  options: {
    advance?: boolean;
    contextReady?: boolean;
    statusMessage?: string;
  } = {},
): ProviderEnvironmentCreationDecision {
  requireEnvironmentPlacementHost(deps, context.host.id);
  const now = Date.now();
  const policy = record.provider.policy;
  const previous =
    context.environment === null
      ? null
      : getEnvironment(deps.db, context.environment.id);
  let row = getPreparingEnvironment(deps.db, context.thread.id);
  if (
    (row !== null &&
      row.attempt > 0 &&
      row.environmentProviderPluginId !== record.pluginId) ||
    (previous !== null &&
      previous.environmentProviderId !== null &&
      previous.environmentProviderPluginId !== record.pluginId)
  ) {
    return {
      action: "reject",
      message:
        "The environment provider belongs to a different plugin or has no recorded owner.",
    };
  }
  if (
    previous?.teardownStatus === "running" ||
    previous?.teardownStatus === "failed"
  )
    return {
      action: "wait",
      reason: "Removing the previous environment",
      sendAt: now + 1000,
    };
  const selected = { machine: context.machine, inputs: context.inputs };
  const changed =
    row !== null &&
    (row.environmentProviderId !== record.provider.id ||
      JSON.stringify(row.environmentProviderSelection) !==
        JSON.stringify(selected));
  if (
    row !== null &&
    !changed &&
    row.status === "error" &&
    row.teardownStatus !== "running" &&
    row.teardownStatus !== "failed"
  ) {
    return {
      action: "reject",
      message: row.statusMessage ?? "Environment creation failed",
    };
  }
  if (
    row !== null &&
    row.teardownStatus !== "removed" &&
    (changed || row.teardownStatus !== null)
  ) {
    void cancelProviderEnvironmentCreation(deps, context.thread.id).catch(
      (error) =>
        deps.logger.warn(
          {
            threadId: context.thread.id,
            error: error instanceof Error ? error.message : String(error),
          },
          "Environment cleanup will retry",
        ),
    );
    return {
      action: "wait",
      reason: "Removing the previous environment",
      sendAt: now + 1000,
    };
  }
  const start = row === null || row.teardownStatus === "removed";
  if (start) {
    const attempt = (row?.attempt ?? previous?.attempt ?? 0) + 1;
    const pathKey =
      policy.pathKeys === "per-attempt" || context.environment !== null
        ? `${context.thread.id}-${attempt}`
        : context.thread.id;
    row = reserveEnvironment(deps.db, {
      projectId: context.project.id,
      ownerThreadId: context.thread.id,
      environmentProviderId: record.provider.id,
      environmentProviderPluginId: record.pluginId,
      attempt: attempt,
      status: "creating",
      environmentProviderInstanceKey: pathKey,
      hostId: context.host.id,
      statusMessage:
        options.statusMessage ??
        `${context.environment === null ? "Preparing" : "Restoring"} ${record.provider.displayName}…`,
      environmentProviderSelection: selected,
    });
    deps.hub.notifyEnvironment(row.id, ["environment-created"]);
    const startup = getThreadProvisionContext(deps.db, context.thread.id);
    if (startup !== null) {
      appendThreadProvisioningEvent(deps, {
        threadId: context.thread.id,
        environmentId: row.id,
        provisioningId: startup.state.provisioningId,
        status: "active",
        entries: [
          {
            type: "step",
            key: `provider-step-${row.attempt}-${row.statusMessage}`,
            text: row.statusMessage ?? "Creating environment",
            status: "started",
          },
        ],
      });
      deps.hub.notifyThread(context.thread.id, ["events-appended"], {
        eventTypes: ["system/thread-provisioning"],
      });
    }
    if (options.advance !== false)
      void advanceEnvironmentProvisioning(deps, {
        environmentId: row.id,
        creation: {
          record,
          ...(options.contextReady === false ? {} : { context }),
        },
      });
  }
  if (row === null) throw new Error("Missing environment provisioning");
  if (
    (row.status === "provisioning" || row.status === "ready") &&
    row.path !== null
  )
    return { action: "ready", environment: row };
  if (row.status === "creating")
    void advanceEnvironmentProvisioning(deps, {
      environmentId: row.id,
      creation: {
        record,
        ...(options.contextReady === false ? {} : { context }),
      },
    });
  return {
    action: "wait",
    reason: row.statusMessage ?? "Creating environment",
    sendAt: now + 1000,
  };
}

async function providerPlacement(
  deps: PlacementDeps,
  projectId: string,
  environmentProviderId: string,
  requested: ProviderSelection,
): Promise<ThreadEnvironmentPlacement> {
  const selection = await resolveCompleteProviderSelection(
    deps,
    projectId,
    environmentProviderId,
    requested,
  );
  return {
    environmentId: null,
    environmentIntent: {
      type: "provider",
      environmentProviderId,
      ...selection,
    },
  };
}
