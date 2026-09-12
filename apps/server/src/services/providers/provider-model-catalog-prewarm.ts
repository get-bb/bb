import { getHost } from "@bb/db";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { listSystemProviderInfosForHost } from "../system/execution-options.js";

const PER_HOST_CONCURRENCY = 2;
const GLOBAL_CONCURRENCY = 4;

export function installProviderModelCatalogPrewarm(
  deps: LoggedWorkSessionDeps,
): { stop(): void } {
  const pendingHosts = new Set<string>();
  const runningHosts = new Set<string>();
  const globalWaiters: (() => void)[] = [];
  let globalRunning = 0;
  let stopped = false;

  function request(hostId: string): void {
    if (stopped) {
      return;
    }
    pendingHosts.add(hostId);
    if (!runningHosts.has(hostId)) {
      void runPasses(hostId);
    }
  }

  async function runPasses(hostId: string): Promise<void> {
    runningHosts.add(hostId);
    try {
      while (!stopped && pendingHosts.delete(hostId)) {
        try {
          await runPass(hostId);
        } catch (error) {
          deps.logger.error(
            { hostId, ...runtimeErrorLogFields(deps.config, error) },
            "Provider model catalog prewarm pass failed",
          );
        }
      }
    } finally {
      runningHosts.delete(hostId);
    }
  }

  async function acquireGlobalSlot(): Promise<void> {
    if (globalRunning < GLOBAL_CONCURRENCY) {
      globalRunning += 1;
      return;
    }
    await new Promise<void>((resolve) => globalWaiters.push(resolve));
  }

  function releaseGlobalSlot(): void {
    const next = globalWaiters.shift();
    if (next === undefined) {
      globalRunning -= 1;
    } else {
      next();
    }
  }

  async function runPass(hostId: string): Promise<void> {
    const startedAt = Date.now();
    await deps.providerRegistry.whenRegistrationsSettled();
    const sessionId = deps.hub.getDaemonSessionIdForHost(hostId);
    const host = getHost(deps.db, hostId);
    if (
      stopped ||
      sessionId === null ||
      host === null ||
      host.destroyedAt !== null ||
      host.type === "ephemeral" ||
      host.phase !== "active"
    ) {
      return;
    }
    const providers = await listSystemProviderInfosForHost(deps, hostId);
    const defaultProviderId = deps.providerRegistry.getUserDefaultProviderId();
    const queue = providers
      .filter((provider) => provider.available)
      .sort(
        (left, right) =>
          Number(right.id === defaultProviderId) -
          Number(left.id === defaultProviderId),
      );
    const providerCount = queue.length;
    await Promise.all(
      Array.from({ length: PER_HOST_CONCURRENCY }, async () => {
        for (
          let provider = queue.shift();
          provider !== undefined;
          provider = queue.shift()
        ) {
          await acquireGlobalSlot();
          try {
            if (
              stopped ||
              deps.hub.getDaemonSessionIdForHost(hostId) !== sessionId
            ) {
              return;
            }
            await deps.lifecycleDedupers.providerModelCatalogs.refreshForPrewarm(
              deps,
              { hostId, provider },
            );
          } catch (error) {
            deps.logger.error(
              {
                hostId,
                providerId: provider.id,
                ...runtimeErrorLogFields(deps.config, error),
              },
              "Provider model catalog prewarm task failed",
            );
          } finally {
            releaseGlobalSlot();
          }
        }
      }),
    );
    deps.logger.info(
      { hostId, providerCount, durationMs: Date.now() - startedAt },
      "Provider model catalog prewarm pass finished",
    );
  }

  const unsubscribe = deps.hub.onChangedMessage((message) => {
    if (
      message.entity === "host" &&
      message.changes.includes("host-connected")
    ) {
      request(message.id);
    } else if (
      message.entity === "system" &&
      message.changes.includes("provider-registrations-changed")
    ) {
      for (const hostId of deps.hub.listConnectedHostIds()) {
        request(hostId);
      }
    }
  });
  for (const hostId of deps.hub.listConnectedHostIds()) {
    request(hostId);
  }

  return {
    stop() {
      stopped = true;
      unsubscribe();
      pendingHosts.clear();
    },
  };
}
