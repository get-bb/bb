import { createAsyncTtlMemo, type AsyncTtlMemo } from "@bb/async-cache";
import type {
  HostDaemonBridgeLaunch,
  ProviderCliInstallActionKind,
  ProviderCliInstallEvent,
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import type { ProviderInfo } from "@bb/domain";
import { isDeepStrictEqual } from "node:util";
import { ZodError } from "zod";
import type { WorkSessionDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import {
  callHostRetryableOnlineRpc,
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

const statusCaches = new WeakMap<
  object,
  AsyncTtlMemo<string, ProviderInstallationStatus>
>();

export const PROVIDER_INSTALLATION_STATUS_FRESH_MS = 30_000;

function providerStatusCache(deps: WorkSessionDeps) {
  let cache = statusCaches.get(deps.db);
  if (!cache) {
    cache = createAsyncTtlMemo<string, ProviderInstallationStatus>({
      maxEntries: 1_024,
      ttlMs: PROVIDER_INSTALLATION_STATUS_FRESH_MS,
      staleWhileRevalidate: true,
    });
    statusCaches.set(deps.db, cache);
  }
  return cache;
}

export type ProviderInstallationsReadMode = "prewarm" | "read" | "refresh";

export async function getProviderInstallations(
  deps: WorkSessionDeps,
  args: { hostId: string; mode: ProviderInstallationsReadMode },
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
          return await providerStatusCache(deps).run(
            `${args.hostId} ${provider.id} ${deps.providerRegistry.getRegistrationRevision()} ${JSON.stringify(bridgeLaunch)}`,
            () =>
              callHostRetryableOnlineRpc(deps, {
                hostId: args.hostId,
                timeoutMs,
                command: {
                  type: "provider.installation.status",
                  providerId: provider.id,
                  bridgeLaunch,
                },
              }),
            {
              refresh: args.mode === "refresh",
              revalidateStale: args.mode !== "prewarm",
              onReplaced: (previous, next) => {
                if (!isDeepStrictEqual(previous, next)) {
                  deps.hub.notifyHost(args.hostId, [
                    "provider-cli-status-changed",
                  ]);
                }
              },
              onRevalidateError: (error) => {
                deps.logger.warn(
                  {
                    err: error,
                    failure: "status_refresh_failed",
                    hostId: args.hostId,
                    providerId: provider.id,
                  },
                  "Failed to refresh provider installation status; keeping the previous status",
                );
              },
            },
          );
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

export function invalidateProviderInstallationStatus(
  deps: WorkSessionDeps,
  hostId: string,
): void {
  providerStatusCache(deps).invalidateWhere((key) =>
    key.startsWith(`${hostId} `),
  );
}

export async function settleUnneededProviderInstallation(
  deps: WorkSessionDeps,
  args: {
    hostId: string;
    providerId: string;
    action: ProviderCliInstallActionKind;
    bridgeLaunch: HostDaemonBridgeLaunch;
    events: ProviderCliInstallEvent[];
  },
): Promise<ProviderCliInstallEvent[]> {
  const refused =
    args.events.some((event) => event.type === "error") &&
    !args.events.some((event) => event.type === "completed");
  if (!refused) return args.events;
  let status: ProviderInstallationStatus;
  try {
    status = await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "provider.installation.status",
        providerId: args.providerId,
        bridgeLaunch: args.bridgeLaunch,
      },
    });
  } catch {
    return args.events;
  }
  const current =
    args.action === "install"
      ? status.installed
      : status.installed && !status.needsUpdate && !status.versionUnsupported;
  return current
    ? [
        {
          type: "completed",
          provider: args.providerId,
          exitCode: null,
          signal: null,
          success: true,
        },
      ]
    : args.events;
}
