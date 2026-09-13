import { getProjectSourceByHost } from "@bb/db";
import { isLocalPathProjectSource, PERSONAL_PROJECT_ID } from "@bb/domain";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { WorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  getNonDestroyedHostWithStatus,
  requirePublicProject,
  listPublicHostsWithStatus,
} from "../lib/entity-lookup.js";
import {
  acceptsEmptyInputs,
  parseProviderAvailabilityInvocation,
} from "../lib/provider-availability.js";
import {
  environmentProviderDecisionTimeoutMs,
  invokeEnvironmentProvider,
  type PluginEnvironmentProviderRecord,
} from "../plugins/plugin-environment-provider-registry.js";
import type {
  PluginEnvironmentProviderAvailability,
  PluginEnvironmentProviderAvailabilityContext,
} from "@get-bb/plugin-sdk/environment-provider";
import { decideWithinBox } from "../threads/dispatch-hooks.js";

type GitCheckoutAvailability =
  | { status: "available" }
  | { status: "unavailable"; message: string };
export type EnvironmentProviderAvailabilityResolution =
  | { ok: true; availability: PluginEnvironmentProviderAvailability }
  | { ok: false; message: string };

export function environmentProviderAcceptsEmptyInputs(
  record: PluginEnvironmentProviderRecord,
): Promise<boolean> {
  return acceptsEmptyInputs(record.provider, (run) =>
    invokeEnvironmentProvider(
      record,
      `"${record.provider.id}" environment provider empty inputs`,
      run,
    ),
  );
}

export function environmentProviderMatchesContext(
  deps: WorkSessionDeps,
  record: PluginEnvironmentProviderRecord,
  query: { projectId: string; hostId?: string },
): boolean {
  const project = requirePublicProject(deps.db, query.projectId);
  const hosts =
    query.hostId === undefined
      ? listPublicHostsWithStatus(deps)
      : [getNonDestroyedHostWithStatus(deps, query.hostId)];
  return hosts.some((host) => {
    if (host === null) return false;
    const requires = record.provider.requires;
    if (requires.projectless !== (project.id === PERSONAL_PROJECT_ID)) {
      return false;
    }
    const source = getProjectSourceByHost(deps.db, project.id, host.id);
    const projectCheckout =
      source !== null && isLocalPathProjectSource(source)
        ? { path: source.path }
        : null;
    if (
      (requires.projectCheckout || requires.gitCheckout) &&
      projectCheckout === null
    ) {
      return false;
    }
    if (requires.gitRemote && project.gitRemoteUrl === null) return false;
    return true;
  });
}

export async function resolvePluginEnvironmentProviderAvailability(
  record: PluginEnvironmentProviderRecord,
  context: PluginEnvironmentProviderAvailabilityContext,
): Promise<EnvironmentProviderAvailabilityResolution> {
  const availability = record.provider.availability;
  if (availability === null) {
    return { ok: true, availability: { status: "available" } };
  }
  const invocation = await invokeEnvironmentProvider(
    record,
    `"${record.provider.id}" environment provider availability`,
    () =>
      decideWithinBox(
        () => Promise.resolve(availability(context)),
        environmentProviderDecisionTimeoutMs(),
      ),
  );
  return parseProviderAvailabilityInvocation(record.pluginId, invocation);
}

const pendingGitInspections = new WeakMap<
  object,
  Map<string, Promise<GitCheckoutAvailability>>
>();

export function resolveGitCheckoutAvailability(
  deps: WorkSessionDeps,
  args: { hostId: string; path: string },
): Promise<GitCheckoutAvailability> {
  let pending = pendingGitInspections.get(deps.db);
  if (pending === undefined) {
    pending = new Map();
    pendingGitInspections.set(deps.db, pending);
  }
  const key = JSON.stringify([args.hostId, args.path]);
  const existing = pending.get(key);
  if (existing !== undefined) return existing;
  const result = inspectGitCheckoutAvailability(deps, args).finally(() =>
    pending.delete(key),
  );
  pending.set(key, result);
  return result;
}

async function inspectGitCheckoutAvailability(
  deps: WorkSessionDeps,
  args: { hostId: string; path: string },
): Promise<GitCheckoutAvailability> {
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
    if (
      inspection.checkout.kind === "unknown" ||
      inspection.checkout.kind === "unborn" ||
      inspection.checkout.headSha === null
    ) {
      return {
        status: "unavailable",
        message: "This project checkout has no usable git branch.",
      };
    }
    return { status: "available" };
  } catch {
    return {
      status: "unavailable",
      message: "This project checkout could not be inspected.",
    };
  }
}
