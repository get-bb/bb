import type { LoggedWorkSessionDeps } from "../../types.js";
import { installHostConnectPrewarm } from "../hosts/host-connect-prewarm.js";
import { runtimeErrorLogFields } from "../lib/error-log-fields.js";
import { listSystemProviderInfosForHost } from "../system/execution-options.js";

const PER_HOST_CONCURRENCY = 2;
const GLOBAL_CONCURRENCY = 4;

export function installProviderModelCatalogPrewarm(
  deps: LoggedWorkSessionDeps,
): { stop(): void } {
  const globalWaiters: (() => void)[] = [];
  let globalRunning = 0;

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

  return installHostConnectPrewarm(deps, {
    failureMessage: "Provider model catalog prewarm pass failed",
    async runPass({ hostId, isCurrent }) {
      const startedAt = Date.now();
      const providers = await listSystemProviderInfosForHost(deps, hostId);
      const defaultProviderId =
        deps.providerRegistry.getUserDefaultProviderId();
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
              if (!isCurrent()) {
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
    },
  });
}
