import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import type { ProviderInfo } from "@bb/domain";
import { ZodError } from "zod";
import type { WorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import {
  callHostRetryableOnlineRpcWithoutAdmission,
  callHostRetryableOnlineRpc,
  callHostOnlineRpc,
  isHostUnavailableApiError,
} from "../hosts/online-rpc.js";
import { listSystemProviderInfos } from "./execution-options.js";
import { resolveBridgeLaunchForProviderId } from "./provider-bridge-launch.js";
import { mapProviderMaintenanceRequests } from "./provider-maintenance-concurrency.js";

export const PROVIDER_INSTALLATION_STATUS_TIMEOUT_MS = 70_000;

type InstallationProvider = Pick<ProviderInfo, "displayName" | "id">;
type ProviderInstallationStatus = Omit<ProviderCliStatus, "displayName">;
type PreparedProviderInstallationRequest = (
  timeoutMs: number,
) => Promise<ProviderInstallationStatus | null>;

interface ProviderInstallationAggregationOptions {
  deadlineMs: number;
  now: () => number;
  onDeadlineExceeded: (provider: InstallationProvider) => void;
  prepare: (
    provider: InstallationProvider,
  ) => PreparedProviderInstallationRequest | null;
}

function canOmitProviderInstallationStatusError(error: unknown): boolean {
  if (error instanceof ZodError) return true;
  return (
    error instanceof ApiError &&
    !isHostUnavailableApiError(error) &&
    (error.status === 502 || error.status === 504)
  );
}

export async function aggregateProviderInstallations(
  providers: readonly InstallationProvider[],
  options: ProviderInstallationAggregationOptions,
): Promise<ProviderCliStatusResponse> {
  const entries = await mapProviderMaintenanceRequests(
    providers,
    async (provider): Promise<[string, ProviderCliStatus] | null> => {
      const request = options.prepare(provider);
      if (request === null) return null;
      const remainingMs = options.deadlineMs - options.now();
      if (remainingMs <= 0) {
        options.onDeadlineExceeded(provider);
        return null;
      }
      const status = await request(Math.min(COMMAND_TIMEOUT_MS, remainingMs));
      return status === null
        ? null
        : [provider.id, { displayName: provider.displayName, ...status }];
    },
  );
  return Object.fromEntries(
    entries.filter(
      (entry): entry is [string, ProviderCliStatus] => entry !== null,
    ),
  );
}

export async function getProviderInstallations(
  deps: WorkSessionDeps,
  args: { hostId: string },
): Promise<ProviderCliStatusResponse> {
  const deadline = Date.now() + PROVIDER_INSTALLATION_STATUS_TIMEOUT_MS;
  const providers = await listSystemProviderInfos(deps, {
    hostId: args.hostId,
    capability: "installation",
  });
  return aggregateProviderInstallations(providers, {
    deadlineMs: deadline,
    now: Date.now,
    onDeadlineExceeded: (provider) => {
      deps.logger.warn(
        {
          failure: "aggregate_deadline_exceeded",
          hostId: args.hostId,
          providerId: provider.id,
        },
        "Failed to load provider installation status; omitting provider",
      );
    },
    prepare: (provider) => {
      const bridgeLaunch = resolveBridgeLaunchForProviderId(deps, provider.id);
      if (bridgeLaunch === null) {
        deps.logger.warn(
          {
            failure: "bridge_unavailable",
            hostId: args.hostId,
            providerId: provider.id,
          },
          "Failed to load provider installation status; omitting provider",
        );
        return null;
      }
      return async (timeoutMs) => {
        try {
          return await callHostRetryableOnlineRpcWithoutAdmission(deps, {
            hostId: args.hostId,
            timeoutMs,
            command: {
              type: "provider.installation.status",
              providerId: provider.id,
              bridgeLaunch,
            },
          });
        } catch (error) {
          if (!canOmitProviderInstallationStatusError(error)) {
            throw error;
          }
          deps.logger.warn(
            {
              failure: "status_request_failed",
              hostId: args.hostId,
              providerId: provider.id,
            },
            "Failed to load provider installation status; omitting provider",
          );
          return null;
        }
      };
    },
  });
}

const installationTails = new WeakMap<object, Map<string, Promise<void>>>();
export async function serializeProviderInstallation<T>(
  deps: WorkSessionDeps,
  hostId: string,
  run: () => Promise<T>,
): Promise<T> {
  let hosts = installationTails.get(deps.db);
  if (!hosts) {
    hosts = new Map();
    installationTails.set(deps.db, hosts);
  }
  const previous = hosts.get(hostId) ?? Promise.resolve();
  let release: () => void = () => {};
  const tail = new Promise<void>((resolve) => {
    release = resolve;
  });
  hosts.set(hostId, tail);
  await previous;
  try {
    return await run();
  } finally {
    release();
    if (hosts.get(hostId) === tail) hosts.delete(hostId);
  }
}

export async function ensureProviderInstallation(
  deps: WorkSessionDeps,
  args: { hostId: string; providerId: string },
): Promise<{ ready: boolean; message: string }> {
  return serializeProviderInstallation(deps, args.hostId, async () => {
    await deps.providerRegistry.whenProviderRegistered(args.providerId);
    const registration = deps.providerRegistry.get(args.providerId);
    const bridgeLaunch = resolveBridgeLaunchForProviderId(
      deps,
      args.providerId,
    );
    if (!registration?.info.maintenance.installation || !bridgeLaunch)
      return {
        ready: false,
        message: "This provider has no registered CLI installer",
      };
    const status = () =>
      callHostRetryableOnlineRpc(deps, {
        hostId: args.hostId,
        timeoutMs: COMMAND_TIMEOUT_MS,
        command: {
          type: "provider.installation.status",
          providerId: args.providerId,
          bridgeLaunch,
        },
      });
    let installed = await status();
    if (installed.installed && !installed.versionUnsupported)
      return {
        ready: true,
        message: "Compatible provider CLI already installed",
      };
    if (!installed.installAction)
      return {
        ready: false,
        message: "The provider cannot install a compatible CLI on this host",
      };
    const result = await callHostOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: 10 * 60 * 1000,
      command: {
        type: "provider.installation.run",
        providerId: args.providerId,
        action: installed.installAction.kind,
        bridgeLaunch,
      },
    });
    deps.providerRegistry.forgetInstalledKey(args);
    installed = await status();
    return {
      ready:
        result.events.some(
          (event) => event.type === "completed" && event.success,
        ) &&
        installed.installed &&
        !installed.versionUnsupported,
      message: "Provider CLI installation completed",
    };
  });
}
