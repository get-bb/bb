import type { AvailableModel } from "@bb/domain";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildPiAvailableModels, type PiCatalogModel } from "../model-list.js";

const NETWORK_REFRESH_TIMEOUT_MS = 5_000;

// Retries run in the background and cost the caller nothing, so this only
// bounds pointless work on a host that has no route to pi.dev at all.
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
// Only the first attempt blocks a caller. A host with no route to pi.dev would
// otherwise pay the full timeout on every early picker render, so once the
// first attempt settles, later calls kick off a background retry and answer
// immediately from the current catalog. That keeps worst-case added latency at
// one timeout while still recovering from a transient failure without
// restarting the bridge.
//
// Held as a promise rather than a boolean so concurrent `model/list` calls
// await the same refresh instead of racing past it into a half-refreshed
// snapshot.
let networkRefresh: Promise<void> | undefined;
let networkRefreshAttempts = 0;
let networkRefreshSucceeded = false;
let firstAttemptSettled = false;

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
  if (isPiOffline() || networkRefreshSucceeded) {
    return;
  }
  if (
    !networkRefresh &&
    networkRefreshAttempts < NETWORK_REFRESH_MAX_ATTEMPTS
  ) {
    networkRefreshAttempts += 1;
    const attempt = networkRefreshAttempts;
    networkRefresh = runNetworkRefresh(modelRuntime)
      .then(() => {
        networkRefreshSucceeded = true;
      })
      // Never fail `model/list` on a refresh problem: the persisted store plus
      // the bundled static catalog still produce a usable model set.
      .catch((error: unknown) => {
        logRefreshProblem(
          `attempt ${attempt}/${NETWORK_REFRESH_MAX_ATTEMPTS} ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      })
      .finally(() => {
        networkRefresh = undefined;
        firstAttemptSettled = true;
      });
  }
  // Block only until the first attempt settles. Callers that arrive later get
  // the current catalog immediately while any retry runs in the background.
  if (!firstAttemptSettled) {
    await networkRefresh;
  }
}

type PiAvailableModel = Awaited<
  ReturnType<ModelRuntime["getAvailable"]>
>[number];

/**
 * Narrow one Pi model for the list builder, or drop it.
 *
 * Pi marks `id`, `name`, `provider`, and `input` as required, but an extension
 * registers its models from plain JavaScript and Pi does not validate them. A
 * missing field threw here or inside the builder, which failed the whole call
 * and hid every other provider's models. Skip the bad model instead.
 */
function toPiCatalogModel(model: PiAvailableModel): PiCatalogModel | undefined {
  if (
    typeof model.id !== "string" ||
    model.id.length === 0 ||
    typeof model.name !== "string" ||
    typeof model.provider !== "string" ||
    model.provider.length === 0
  ) {
    return undefined;
  }
  return {
    id: model.id,
    input: Array.isArray(model.input) ? [...model.input] : [],
    name: model.name,
    provider: model.provider,
    reasoning: model.reasoning === true,
    supportedThinkingLevels: getSupportedThinkingLevels(model),
  };
}

export async function listPiBridgeModels(modelRuntime: ModelRuntime): Promise<{
  models: AvailableModel[];
  selectedOnlyModels: AvailableModel[];
}> {
  await ensureNetworkRefresh(modelRuntime);
  const availableModels = await modelRuntime.getAvailable();

  const models: PiCatalogModel[] = [];
  for (const model of availableModels) {
    const catalogModel = toPiCatalogModel(model);
    if (catalogModel) {
      models.push(catalogModel);
      continue;
    }
    process.stderr.write(
      `pi bridge: skipped an incomplete model from provider "${String(model.provider)}"\n`,
    );
  }

  return buildPiAvailableModels({ models });
}

/** @internal Test seam: reset the per-process refresh latch. */
export function resetPiModelNetworkRefreshForTests(): void {
  networkRefresh = undefined;
  networkRefreshAttempts = 0;
  networkRefreshSucceeded = false;
  firstAttemptSettled = false;
}
