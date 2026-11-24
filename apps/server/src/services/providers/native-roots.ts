import {
  providerNativeRootsAreEmpty,
  type ProviderNativeRoots,
} from "@bb/domain";
import type {
  HostDaemonOnlineRpcResult,
  HostNativeRootResolution,
  HostNativeRootScan,
} from "@bb/host-daemon-contract";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import type { AppDeps, WorkSessionDeps } from "../../types.js";
import { resolveHostEnvironment } from "../hosts/host-environment.js";
import {
  callHostRetryableOnlineRpc,
  hostCommandTimeoutError,
} from "../hosts/online-rpc.js";
import type { ProviderRegistration } from "./provider-registry.js";

export const PROVIDER_LISTING_BUDGET_FLOOR_MS = 1_000;

export const PROVIDER_NATIVE_ROOTS_RESOLVE_TIMEOUT_MS = 10_000;

export interface ProviderListingBudget {
  remainingMs(): number;
}

export function createProviderListingBudget(
  options: { now?: () => number } = {},
): ProviderListingBudget {
  const now = options.now ?? Date.now;
  const deadline = now() + COMMAND_TIMEOUT_MS;
  return {
    remainingMs() {
      const remaining = deadline - now();
      if (remaining < PROVIDER_LISTING_BUDGET_FLOOR_MS) {
        throw hostCommandTimeoutError();
      }
      return remaining;
    },
  };
}

export type ProviderNativeRootsDeps = WorkSessionDeps & Pick<AppDeps, "logger">;

export function providerHasNativeRootSurface(
  registration: ProviderRegistration,
): boolean {
  return (
    registration.resolvesNativeRoots ||
    !providerNativeRootsAreEmpty(registration.nativeSkillRoots) ||
    !providerNativeRootsAreEmpty(registration.nativeCommandRoots)
  );
}

function nativeRootsResolver(
  deps: ProviderNativeRootsDeps,
  registration: ProviderRegistration,
): HostNativeRootScan["resolver"] {
  if (!registration.resolvesNativeRoots) {
    return null;
  }
  const pluginId = registration.pluginId;
  const providerId = registration.info.id;
  const artifact = deps.pluginHostArtifacts.get(pluginId);
  if (artifact === undefined) {
    deps.logger.warn(
      { pluginId, providerId },
      `Plugin "${pluginId}" resolves native roots for provider "${providerId}" but has no live bb.host artifact; listing its declared roots only`,
    );
    return null;
  }
  return {
    pluginId,
    generation: artifact.generation,
    artifact: { digest: artifact.digest, byteLength: artifact.byteLength },
  };
}

function providerNativeRootScan(
  deps: ProviderNativeRootsDeps,
  registration: ProviderRegistration,
): HostNativeRootScan {
  return {
    providerId: registration.info.id,
    declaredRoots: {
      skills: {
        user: [...registration.nativeSkillRoots.user],
        project: [...registration.nativeSkillRoots.project],
      },
      commands: {
        user: [...registration.nativeCommandRoots.user],
        project: [...registration.nativeCommandRoots.project],
      },
    },
    resolver: nativeRootsResolver(deps, registration),
  };
}

async function nativeRootResolution(
  deps: ProviderNativeRootsDeps,
  args: {
    hostId: string;
    scans: readonly HostNativeRootScan[];
    budget: ProviderListingBudget;
  },
): Promise<HostNativeRootResolution> {
  const contributedEnv = args.scans.some((scan) => scan.resolver !== null)
    ? await resolveHostEnvironment(deps, {
        hostId: args.hostId,
        projectId: null,
      })
    : [];
  return {
    contributedEnv,
    timeoutMs: Math.max(
      1,
      Math.min(
        PROVIDER_NATIVE_ROOTS_RESOLVE_TIMEOUT_MS,
        args.budget.remainingMs() - PROVIDER_LISTING_BUDGET_FLOOR_MS,
      ),
    ),
  };
}

export async function listProviderNativeCommands(
  deps: ProviderNativeRootsDeps,
  args: {
    registration: ProviderRegistration;
    hostId: string;
    cwd: string | null;
  },
): Promise<HostDaemonOnlineRpcResult<"host.list_commands">> {
  const budget = createProviderListingBudget();
  const provider = providerNativeRootScan(deps, args.registration);
  const resolution = await nativeRootResolution(deps, {
    hostId: args.hostId,
    scans: [provider],
    budget,
  });
  return callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: budget.remainingMs(),
    command: {
      type: "host.list_commands",
      cwd: args.cwd,
      provider,
      resolution,
    },
  });
}

export async function listNativeRootSkills(
  deps: ProviderNativeRootsDeps,
  args: {
    registrations: readonly ProviderRegistration[];
    sharedRoots: ProviderNativeRoots;
    hostId: string;
    cwd: string | null;
  },
): Promise<HostDaemonOnlineRpcResult<"host.list_skills">> {
  const budget = createProviderListingBudget();
  const providers = args.registrations.map((registration) =>
    providerNativeRootScan(deps, registration),
  );
  const resolution = await nativeRootResolution(deps, {
    hostId: args.hostId,
    scans: providers,
    budget,
  });
  return callHostRetryableOnlineRpc(deps, {
    hostId: args.hostId,
    timeoutMs: budget.remainingMs(),
    command: {
      type: "host.list_skills",
      cwd: args.cwd,
      providers,
      sharedRoots: args.sharedRoots,
      resolution,
    },
  });
}
