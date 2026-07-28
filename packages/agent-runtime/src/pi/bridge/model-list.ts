import type { AvailableModel } from "@bb/domain";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildPiAvailableModels } from "../model-list.js";

const NETWORK_REFRESH_TIMEOUT_MS = 5_000;

// A failed attempt costs the full timeout, so cap how many picker renders can
// pay it. Three keeps worst-case cumulative stall bounded while still letting
// a transient failure recover without restarting the bridge.
const NETWORK_REFRESH_MAX_ATTEMPTS = 3;

// The network refresh fans out one request per provider to pi.dev and can
// stall for the whole budget: on some hosts a single request never returns,
// hitting the ceiling on roughly one in three cold calls. This runs on every
// picker render and thread-detail bootstrap, so refresh at most once
// successfully per bridge process. The bridge is long-lived (spawned once
// under the "pi" process key and never idle-reaped), and later calls resolve
// from the persisted model store plus the bundled static catalog, which yields
// the same model set.
//
// Held as a promise rather than a boolean so concurrent `model/list` calls
// await the same refresh instead of racing past it into a half-refreshed
// snapshot.
let networkRefresh: Promise<void> | undefined;
let networkRefreshAttempts = 0;

function logRefreshProblem(message: string): void {
  process.stderr.write(`pi bridge: model catalog refresh ${message}\n`);
}

// Pi disables its own catalog network access when PI_OFFLINE is set. Passing
// `allowNetwork: true` unconditionally would override that, so honor it here.
function isPiOffline(): boolean {
  return process.env.PI_OFFLINE !== undefined;
}

async function runNetworkRefresh(modelRuntime: ModelRuntime): Promise<void> {
  const result = await modelRuntime.refresh({
    allowNetwork: true,
    signal: AbortSignal.timeout(NETWORK_REFRESH_TIMEOUT_MS),
  });

  for (const [providerId, error] of result.errors) {
    logRefreshProblem(
      `failed for provider "${providerId}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // An aborted refresh left some providers on the stale catalog, so let a
  // later call retry rather than pinning the process to it.
  if (result.aborted) {
    throw new Error(`timed out after ${NETWORK_REFRESH_TIMEOUT_MS}ms`);
  }
}

async function ensureNetworkRefresh(modelRuntime: ModelRuntime): Promise<void> {
  if (isPiOffline()) {
    return;
  }
  if (!networkRefresh) {
    if (networkRefreshAttempts >= NETWORK_REFRESH_MAX_ATTEMPTS) {
      return;
    }
    networkRefreshAttempts += 1;
    networkRefresh = runNetworkRefresh(modelRuntime).catch((error: unknown) => {
      // Drop the memo so the next call can retry, and never fail
      // `model/list` on it: the persisted store plus the bundled static
      // catalog still produce a usable model set.
      networkRefresh = undefined;
      logRefreshProblem(
        `attempt ${networkRefreshAttempts}/${NETWORK_REFRESH_MAX_ATTEMPTS} ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    });
  }
  await networkRefresh;
}

export async function listPiBridgeModels(modelRuntime: ModelRuntime): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  await ensureNetworkRefresh(modelRuntime);
  const availableModels = await modelRuntime.getAvailable();

  return buildPiAvailableModels({
    models: availableModels.map((model) => ({
      id: model.id,
      input: [...model.input],
      name: model.name,
      provider: model.provider,
      reasoning: model.reasoning,
      supportedThinkingLevels: getSupportedThinkingLevels(model),
    })),
  });
}

/** @internal Test seam: reset the per-process refresh latch. */
export function resetPiModelNetworkRefreshForTests(): void {
  networkRefresh = undefined;
  networkRefreshAttempts = 0;
}
