import {
  findProjectEnvironmentByHostPath,
  getAppSettings,
  getProjectSourceByHost,
  getThread,
  insertHeldEnvironment,
  listProjectSourcesByProjectIds,
  type EnvironmentRow,
} from "@bb/db";
import {
  canonicalizeHostPath,
  isAbsoluteHostPath,
  PERSONAL_PROJECT_ID,
  type EnvironmentHolder,
  type Host,
  type JsonValue,
  type Thread,
} from "@bb/domain";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import {
  getNonDestroyedHostWithStatus,
  requirePublicProject,
} from "../lib/entity-lookup.js";
import {
  getEnvironmentProvider,
  invokeEnvironmentProvider,
  listEnvironmentCompositions,
  type PluginEnvironmentProviderRecord,
} from "../plugins/plugin-environment-provider-registry.js";
import { requirePrimaryHostId } from "../hosts/primary-host.js";
import { buildSuggestedBranchName } from "../threads/thread-create-helpers.js";
import {
  completeProviderSelection,
  toProviderProjectCheckout,
} from "../threads/thread-environment-placement.js";
import { DEFAULT_ENVIRONMENT_PROVIDER_ID } from "./environment-provider-ids.js";
import { once } from "../lib/once.js";
import { threadTitleSettled } from "../threads/thread-metadata-inference.js";
import { assertEnvironmentPathAvailable } from "./path-admission.js";
import {
  advanceEnvironmentProvisioning,
  versionOneThreadlessRefusal,
  type ProviderOperationContext,
} from "./environment-engine.js";

type CreationDeps = LoggedPendingInteractionWorkSessionDeps;

export interface CreateEnvironmentBeforeThreadArgs {
  projectId: string;
  hostId: string | null;
  provider: { id: string; inputs: JsonValue | null } | null;
  name: string | null;
  heldBy: EnvironmentHolder;
}

function defaultHostId(deps: CreationDeps, projectId: string): string {
  const sources = listProjectSourcesByProjectIds(deps.db, [projectId]).filter(
    (candidate) => candidate.type === "local_path",
  );
  return (
    (sources.find((candidate) => candidate.isDefault) ?? sources[0])?.hostId ??
    requirePrimaryHostId(deps)
  );
}

function refuse(message: string, status: 400 | 404 | 409 = 409): never {
  throw new ApiError(
    status,
    status === 409 ? "environment_provider_rejected" : "invalid_request",
    message,
  );
}

export interface LocatedEnvironment {
  path: string;
  reuse: boolean;
  environment: EnvironmentRow | null;
}

export async function locateEnvironment(
  deps: Pick<CreationDeps, "db">,
  record: PluginEnvironmentProviderRecord,
  args: {
    projectId: string;
    host: Host;
    projectCheckout: ProviderOperationContext["projectCheckout"];
    inputs: JsonValue | null;
  },
): Promise<LocatedEnvironment | null> {
  const locate = record.provider.locate;
  if (locate === null) return null;
  const invocation = await invokeEnvironmentProvider(
    record,
    "environment locate",
    async () =>
      locate({
        host: args.host,
        projectCheckout: args.projectCheckout,
        inputs: args.inputs,
      }),
  );
  if (!invocation.ok)
    throw new ApiError(502, "environment_provider_failed", invocation.error);
  const parsed = z
    .object({
      path: z
        .string()
        .min(1)
        .refine(isAbsoluteHostPath)
        .refine((path) => !path.includes("\0")),
      reuse: z.boolean(),
    })
    .nullable()
    .safeParse(invocation.value);
  if (!parsed.success)
    throw new ApiError(
      502,
      "environment_provider_failed",
      "The environment provider located an invalid path",
    );
  if (parsed.data === null) return null;
  const path = canonicalizeHostPath(parsed.data.path);
  const environment = findProjectEnvironmentByHostPath(
    deps.db,
    args.projectId,
    args.host.id,
    path,
  );
  return {
    path,
    reuse: parsed.data.reuse,
    environment:
      environment === null || environment.status === "destroyed"
        ? null
        : environment,
  };
}

export async function createEnvironmentBeforeThread(
  deps: CreationDeps,
  args: CreateEnvironmentBeforeThreadArgs,
): Promise<EnvironmentRow> {
  const project = requirePublicProject(deps.db, args.projectId);
  const hostId = args.hostId ?? defaultHostId(deps, project.id);
  const providerId =
    args.provider?.id ??
    (project.id === PERSONAL_PROJECT_ID
      ? DEFAULT_ENVIRONMENT_PROVIDER_ID.personalWorkspace
      : DEFAULT_ENVIRONMENT_PROVIDER_ID.gitWorktree);
  if (
    listEnvironmentCompositions().some(
      (entry) => entry.composition.id === providerId,
    )
  )
    refuse(
      `The "${providerId}" environment starts a new machine for a thread; create the environment on an existing machine instead`,
      400,
    );
  const record = getEnvironmentProvider(providerId);
  if (record === undefined)
    refuse(`No environment provider "${providerId}" is registered`, 404);
  if (record.provider.apiVersion === 1)
    refuse(versionOneThreadlessRefusal(record));
  const selection = await completeProviderSelection(deps, record, project.id, {
    machine: { type: "existing", hostId },
    inputs:
      args.provider?.inputs ?? (record.provider.inputs === null ? null : {}),
  });
  const host = getNonDestroyedHostWithStatus(deps, hostId);
  if (host === null) refuse(`Machine ${hostId} no longer exists`, 404);
  const located = await locateEnvironment(deps, record, {
    projectId: project.id,
    host,
    projectCheckout: toProviderProjectCheckout(deps.db, {
      checkout: getProjectSourceByHost(deps.db, project.id, hostId),
      hostId,
      projectId: project.id,
    }),
    inputs: selection.inputs,
  });
  if (located?.environment)
    refuse(
      `${located.path} already belongs to environment ${located.environment.id}`,
    );
  if (located !== null)
    assertEnvironmentPathAvailable(deps, {
      hostId,
      path: located.path,
      threadId: null,
    });
  const row = insertHeldEnvironment(deps.db, {
    claimPath: located?.path ?? null,
    projectId: project.id,
    hostId,
    name: args.name,
    heldBy: args.heldBy,
    environmentProviderId: record.provider.id,
    environmentProviderPluginId: record.pluginId,
    environmentProviderSelection: selection,
    environmentProviderInstanceKey: (id) =>
      record.provider.policy.pathKeys === "per-attempt" ? `${id}-1` : id,
    attempt: 1,
    status: "creating",
    createPending: true,
    statusMessage: `Preparing ${record.provider.displayName}…`,
    providerOwnsPath: false,
  });
  deps.hub.notifyEnvironment(row.id, ["environment-created"]);
  void advanceEnvironmentProvisioning(deps, {
    environmentId: row.id,
    creation: { record },
  }).catch((error) =>
    deps.logger.warn(
      { environmentId: row.id, error },
      "Environment creation will resume on the next sweep",
    ),
  );
  return row;
}

export function resolveHeldEnvironmentOperationContext(
  deps: CreationDeps,
  row: EnvironmentRow,
  record: PluginEnvironmentProviderRecord,
  thread: Pick<Thread, "id"> | null,
): ProviderOperationContext {
  const selection = row.environmentProviderSelection;
  if (selection === null || selection.machine.type !== "existing")
    throw new Error("The environment has no machine to be created on");
  const project = requirePublicProject(deps.db, row.projectId);
  const host = getNonDestroyedHostWithStatus(deps, selection.machine.hostId);
  if (host === null)
    throw new Error("The environment's machine no longer exists");
  const projectCheckout = toProviderProjectCheckout(deps.db, {
    checkout: getProjectSourceByHost(deps.db, project.id, host.id),
    hostId: host.id,
    projectId: project.id,
  });
  if (record.provider.requires.projectCheckout && projectCheckout === null)
    throw new Error(
      `The "${record.provider.id}" environment provider works from this project's checkout on the machine, which is no longer configured`,
    );
  return {
    thread: null,
    project,
    host,
    machine: selection.machine,
    projectCheckout,
    gitRemote: record.provider.requires.gitRemote ? project.gitRemoteUrl : null,
    inputs: selection.inputs,
    branchName: once(async () => {
      if (thread !== null) await threadTitleSettled(deps, thread.id);
      const current =
        thread === null ? null : (getThread(deps.db, thread.id) ?? null);
      return buildSuggestedBranchName({
        branchPrefix: getAppSettings(deps.db).managedBranchPrefix,
        title:
          current === null ? row.name : (current.title ?? current.titleFallback),
        id: current?.id ?? row.id,
      });
    }),
    previous: null,
  };
}
