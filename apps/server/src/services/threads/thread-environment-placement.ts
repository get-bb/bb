import { getProjectSourceByHost, type EnvironmentRow } from "@bb/db";
import { z } from "zod";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "../environments/environment-provider-ids.js";
import {
  jsonValueSchema,
  PERSONAL_PROJECT_ID,
  isLocalPathProjectSource,
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
  invokeEnvironmentProvider,
  type PluginEnvironmentProviderRecord,
} from "../plugins/plugin-environment-provider-registry.js";
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
import type { ThreadProvisionEnvironmentIntent } from "./thread-provisioning-context.js";

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

export async function completeProviderSelection(
  deps: PlacementDeps,
  record: PluginEnvironmentProviderRecord,
  projectId: string,
  selection: ProviderSelection,
): Promise<ProviderSelection> {
  const environmentProviderId = record.provider.id;
  const requires = record.provider.requires;
  const machine = selection.machine;
  requireNonDestroyedHostWithStatus(deps, machine.hostId);
  if (requires.projectCheckout) {
    requireSourceForHost(deps, projectId, machine.hostId);
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
  const projectCheckout =
    checkout !== null && isLocalPathProjectSource(checkout)
      ? { path: checkout.path }
      : null;
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
    const selection = await resolveCompleteProviderSelection(
      deps,
      args.projectId,
      requested.environmentProviderId,
      requested,
    );
    return {
      environmentId: null,
      environmentIntent: {
        type: "provider",
        environmentProviderId: requested.environmentProviderId,
        machine: selection.machine,
        inputs: selection.inputs,
        selectionResolved: selection.selectionResolved,
        produced: null,
      },
    };
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
        const selection = await resolveCompleteProviderSelection(
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
        return {
          environmentId: null,
          environmentIntent: {
            type: "provider",
            environmentProviderId: DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree,
            machine: selection.machine,
            inputs: selection.inputs,
            selectionResolved: selection.selectionResolved,
            produced: null,
          },
        };
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
      const selection = await resolveCompleteProviderSelection(
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
      return {
        environmentId: null,
        environmentIntent: {
          type: "provider",
          environmentProviderId:
            DEFAULT_ENVIRONMENT_PROVIDER_ID.projectCheckout,
          machine: selection.machine,
          inputs: selection.inputs,
          selectionResolved: selection.selectionResolved,
          produced: null,
        },
      };
    }
    case "personal": {
      const selection = await resolveCompleteProviderSelection(
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
      return {
        environmentId: null,
        environmentIntent: {
          type: "provider",
          environmentProviderId:
            DEFAULT_ENVIRONMENT_PROVIDER_ID.personalWorkspace,
          machine: selection.machine,
          inputs: selection.inputs,
          selectionResolved: selection.selectionResolved,
          produced: null,
        },
      };
    }
  }
}
