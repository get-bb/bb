import {
  getHost,
  getProjectDefaultEnvironment,
  listProjectSourcesByProjectIds,
  type ProjectDefaultEnvironmentRecord,
} from "@bb/db";
import {
  findLocalPathProjectSourceForHost,
  type JsonValue,
  type Project,
  type ProjectSource,
} from "@bb/domain";
import type {
  DefaultEnvironment,
  DefaultEnvironmentProblem,
  DefaultEnvironmentProblemReason,
  ProviderEnvironmentArgs,
} from "@bb/server-contract";
import { ApiError } from "../../errors.js";
import type { AppDeps } from "../../types.js";
import { environmentProviderAcceptsEmptyInputs } from "../environments/provider-availability.js";
import { machineProviderAcceptsEmptyInputs } from "../machines/provider-availability.js";
import {
  getEnvironmentProvider,
  listEnvironmentCompositions,
  type PluginEnvironmentProviderRecord,
} from "../plugins/plugin-environment-provider-registry.js";
import { getMachineProvider } from "../plugins/plugin-machine-provider-registry.js";

type DefaultEnvironmentDeps = Pick<AppDeps, "db">;
type DefaultEnvironmentProject = Pick<Project, "id" | "name" | "gitRemoteUrl">;

interface DefaultEnvironmentTarget {
  compositionDisplayName: string | null;
  compositionMachineProviderId: string | null;
  provider: PluginEnvironmentProviderRecord;
}

type TargetResolution =
  | { ok: true; target: DefaultEnvironmentTarget }
  | { ok: false; problem: DefaultEnvironmentProblem };

function problem(
  reason: DefaultEnvironmentProblemReason,
  message: string,
): DefaultEnvironmentProblem {
  return { reason, message };
}

function findComposition(environmentProviderId: string) {
  return (
    listEnvironmentCompositions().find(
      (record) => record.composition.id === environmentProviderId,
    )?.composition ?? null
  );
}

function resolveTarget(environmentProviderId: string): TargetResolution {
  const composition = findComposition(environmentProviderId);
  const targetId = composition?.environmentProviderId ?? environmentProviderId;
  const provider = getEnvironmentProvider(targetId);
  if (provider === undefined) {
    return {
      ok: false,
      problem:
        composition === null
          ? problem(
              "environment_provider_missing",
              `the "${environmentProviderId}" environment provider is not registered`,
            )
          : problem(
              "composition_target_missing",
              `it needs the "${targetId}" environment provider, which is not registered`,
            ),
    };
  }
  return {
    ok: true,
    target: {
      compositionDisplayName: composition?.displayName ?? null,
      compositionMachineProviderId: composition?.machineProviderId ?? null,
      provider,
    },
  };
}

function isEmptyInputs(inputs: JsonValue | null | undefined): boolean {
  return (
    inputs === null ||
    inputs === undefined ||
    (typeof inputs === "object" &&
      !Array.isArray(inputs) &&
      Object.keys(inputs).length === 0)
  );
}

function providerDefaultInputs(
  provider: PluginEnvironmentProviderRecord,
): JsonValue | null {
  return provider.provider.inputs === null ? null : {};
}

function findStaticProblem(
  deps: DefaultEnvironmentDeps,
  project: DefaultEnvironmentProject,
  sources: readonly ProjectSource[],
  record: ProjectDefaultEnvironmentRecord,
  target: DefaultEnvironmentTarget,
): DefaultEnvironmentProblem | null {
  const requires = target.provider.provider.requires;
  const targetId = target.provider.provider.id;
  if (requires.projectless) {
    return problem(
      "projectless_provider",
      `the "${targetId}" environment provider serves only threads that have no project`,
    );
  }
  if (target.compositionMachineProviderId !== null) {
    if (getMachineProvider(target.compositionMachineProviderId) === undefined) {
      return problem(
        "machine_provider_missing",
        `the "${target.compositionMachineProviderId}" machine provider is not registered`,
      );
    }
    if (
      (requires.projectCheckout || requires.gitRemote) &&
      project.gitRemoteUrl === null
    ) {
      return problem(
        "git_remote_missing",
        `${project.name} has no Git remote to clone onto a new machine`,
      );
    }
    return null;
  }
  const machine = record.selection.machine;
  if (machine.type !== "existing") {
    return problem(
      "machine_missing",
      `the "${targetId}" environment provider needs an existing machine`,
    );
  }
  const host = getHost(deps.db, machine.hostId);
  if (host === null || host.destroyedAt !== null) {
    return problem("machine_missing", "its machine no longer exists");
  }
  if (host.phase === "removing") {
    return problem("machine_removing", `${host.name} is being removed`);
  }
  if (host.type !== "persistent") {
    return problem(
      "machine_not_persistent",
      `${host.name} is a temporary machine`,
    );
  }
  if (requires.projectCheckout) {
    if (findLocalPathProjectSourceForHost(sources, host.id) === undefined) {
      return problem(
        "project_source_missing",
        `${host.name} has no checkout of ${project.name}`,
      );
    }
  }
  if (requires.gitRemote && project.gitRemoteUrl === null) {
    return problem(
      "git_remote_missing",
      `${project.name} has no Git remote, which the "${targetId}" environment provider needs`,
    );
  }
  return null;
}

async function findInputsProblem(
  target: DefaultEnvironmentTarget,
): Promise<DefaultEnvironmentProblem | null> {
  if (!(await environmentProviderAcceptsEmptyInputs(target.provider))) {
    return problem(
      "inputs_invalid",
      `the "${target.provider.provider.id}" environment provider needs inputs, which a project default cannot carry`,
    );
  }
  if (target.compositionMachineProviderId === null) {
    return null;
  }
  const machineProvider = getMachineProvider(target.compositionMachineProviderId);
  if (
    machineProvider !== undefined &&
    !(await machineProviderAcceptsEmptyInputs(machineProvider))
  ) {
    return problem(
      "inputs_invalid",
      `the "${target.compositionMachineProviderId}" machine provider needs inputs, which a project default cannot carry`,
    );
  }
  return null;
}

async function checkProjectDefaultEnvironment(
  deps: DefaultEnvironmentDeps,
  project: DefaultEnvironmentProject,
  sources: readonly ProjectSource[],
  record: ProjectDefaultEnvironmentRecord,
): Promise<TargetResolution> {
  const resolution = resolveTarget(record.environmentProviderId);
  if (!resolution.ok) {
    return resolution;
  }
  const found =
    findStaticProblem(deps, project, sources, record, resolution.target) ??
    (await findInputsProblem(resolution.target));
  return found === null ? resolution : { ok: false, problem: found };
}

export async function findProjectDefaultEnvironmentProblem(
  deps: DefaultEnvironmentDeps,
  project: DefaultEnvironmentProject,
  sources: readonly ProjectSource[],
  record: ProjectDefaultEnvironmentRecord,
): Promise<DefaultEnvironmentProblem | null> {
  const check = await checkProjectDefaultEnvironment(
    deps,
    project,
    sources,
    record,
  );
  return check.ok ? null : check.problem;
}

function listSources(
  deps: DefaultEnvironmentDeps,
  projectId: string,
): readonly ProjectSource[] {
  return listProjectSourcesByProjectIds(deps.db, [projectId]);
}

export function toDefaultEnvironmentResponse(
  record: ProjectDefaultEnvironmentRecord,
): DefaultEnvironment {
  return {
    type: "provider",
    environmentProviderId: record.environmentProviderId,
    machine: record.selection.machine,
    inputs: record.selection.inputs,
  };
}

export function describeProjectDefaultEnvironment(
  deps: DefaultEnvironmentDeps,
  record: ProjectDefaultEnvironmentRecord,
): string {
  const composition = findComposition(record.environmentProviderId);
  if (composition !== null) {
    return composition.displayName;
  }
  const providerName =
    getEnvironmentProvider(record.environmentProviderId)?.provider
      .displayName ?? `"${record.environmentProviderId}"`;
  const machine = record.selection.machine;
  if (machine.type !== "existing") {
    return providerName;
  }
  const hostName = getHost(deps.db, machine.hostId)?.name;
  return hostName === undefined ? providerName : `${providerName} on ${hostName}`;
}

export async function normalizeProjectDefaultEnvironment(
  deps: DefaultEnvironmentDeps,
  project: DefaultEnvironmentProject,
  request: ProviderEnvironmentArgs,
): Promise<ProjectDefaultEnvironmentRecord> {
  const environmentProviderId = request.environmentProviderId;
  const refuse = (detail: string, reason?: DefaultEnvironmentProblemReason) =>
    new ApiError(
      400,
      "invalid_request",
      `"${environmentProviderId}" cannot be the default environment of ${project.name}: ${detail}`,
      reason === undefined ? undefined : { details: { reason } },
    );
  const resolution = resolveTarget(environmentProviderId);
  if (!resolution.ok) {
    throw refuse(resolution.problem.message, resolution.problem.reason);
  }
  const target = resolution.target;
  if (!isEmptyInputs(request.inputs)) {
    throw refuse(
      "a project default cannot carry environment inputs; choose them for each thread",
    );
  }
  let machine: ProjectDefaultEnvironmentRecord["selection"]["machine"];
  if (target.compositionMachineProviderId !== null) {
    const requested = request.machine;
    if (
      requested !== undefined &&
      (requested.type !== "new" ||
        requested.machineProviderId !== target.compositionMachineProviderId ||
        !isEmptyInputs(requested.inputs))
    ) {
      throw refuse(
        `it creates a new machine with provider "${target.compositionMachineProviderId}", so the machine cannot be chosen`,
      );
    }
    machine = {
      type: "new",
      machineProviderId: target.compositionMachineProviderId,
      inputs: null,
    };
  } else {
    if (request.machine?.type !== "existing") {
      throw refuse("choose the existing machine it runs on");
    }
    machine = { type: "existing", hostId: request.machine.hostId };
  }
  const record: ProjectDefaultEnvironmentRecord = {
    environmentProviderId,
    selection: { machine, inputs: providerDefaultInputs(target.provider) },
  };
  const check = await checkProjectDefaultEnvironment(
    deps,
    project,
    listSources(deps, project.id),
    record,
  );
  if (!check.ok) {
    throw refuse(check.problem.message, check.problem.reason);
  }
  return record;
}

function unavailableError(
  deps: DefaultEnvironmentDeps,
  project: DefaultEnvironmentProject,
  record: ProjectDefaultEnvironmentRecord,
  found: DefaultEnvironmentProblem,
): ApiError {
  return new ApiError(
    409,
    "project_default_environment_unavailable",
    `${project.name} starts new threads in ${describeProjectDefaultEnvironment(deps, record)}, which is unavailable: ${found.message}. Change or reset the default in Project settings → Thread defaults (bb project default-environment set|reset ${project.id}), or choose an environment for this thread.`,
    {
      details: {
        projectId: project.id,
        environmentProviderId: record.environmentProviderId,
        reason: found.reason,
      },
    },
  );
}

export async function requireUsableProjectDefaultEnvironment(
  deps: DefaultEnvironmentDeps,
  project: DefaultEnvironmentProject,
): Promise<DefaultEnvironment | null> {
  const record = getProjectDefaultEnvironment(deps.db, project.id);
  if (record === null) {
    return null;
  }
  const check = await checkProjectDefaultEnvironment(
    deps,
    project,
    listSources(deps, project.id),
    record,
  );
  if (!check.ok) {
    throw unavailableError(deps, project, record, check.problem);
  }
  const target = check.target;
  return {
    type: "provider",
    environmentProviderId: record.environmentProviderId,
    machine:
      target.compositionMachineProviderId === null
        ? record.selection.machine
        : {
            type: "new",
            machineProviderId: target.compositionMachineProviderId,
            inputs: null,
          },
    inputs: isEmptyInputs(record.selection.inputs)
      ? providerDefaultInputs(target.provider)
      : record.selection.inputs,
  };
}
