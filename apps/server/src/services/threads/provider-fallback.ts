import { getAppSettings } from "@bb/db";
import {
  decideProviderFallback,
  hasFullModelWindow,
  type ProviderFallbackDecision,
} from "@bb/domain";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { getProviderUsageLimits } from "../system/usage-limits.js";

export const PROVIDER_FALLBACK_CHECK_TIMEOUT_MS = 2_000;

interface ResolveProviderFallbackArgs {
  hostId: string;
  providerId: string;
  model: string | null;
  resolveDefaultModel: () => Promise<string | null>;
}

async function readProviderUsage(
  deps: LoggedWorkSessionDeps,
  args: { hostId: string; providerId: string },
) {
  return (await getProviderUsageLimits(deps, args))[args.providerId] ?? null;
}

async function decide(
  deps: LoggedWorkSessionDeps,
  args: ResolveProviderFallbackArgs & { fallbackProviderId: string },
): Promise<ProviderFallbackDecision | null> {
  const registry = deps.providerRegistry;
  const providerUsage = await readProviderUsage(deps, args);
  if (providerUsage?.status !== "ok") return null;
  const model =
    args.model === null && hasFullModelWindow(providerUsage.windows)
      ? await args.resolveDefaultModel()
      : args.model;
  const fallbackUsage = await readProviderUsage(deps, {
    hostId: args.hostId,
    providerId: args.fallbackProviderId,
  });
  return decideProviderFallback({
    providerId: args.providerId,
    model,
    fallbackProviderId: args.fallbackProviderId,
    fallbackSelectable:
      !registry.disabledProviderIds().has(args.fallbackProviderId) &&
      registry.get(args.fallbackProviderId)?.info.available === true,
    providerUsage,
    fallbackUsage,
    now: Date.now(),
  });
}

export async function resolveProviderFallback(
  deps: LoggedWorkSessionDeps,
  args: ResolveProviderFallbackArgs,
): Promise<ProviderFallbackDecision | null> {
  const fallbackProviderId = getAppSettings(deps.db).fallbackProviderId;
  if (fallbackProviderId === null || fallbackProviderId === args.providerId) {
    return null;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(
      () => resolve("timeout"),
      PROVIDER_FALLBACK_CHECK_TIMEOUT_MS,
    );
  });
  try {
    const result = await Promise.race([
      decide(deps, { ...args, fallbackProviderId }),
      timedOut,
    ]);
    if (result === "timeout") {
      deps.logger.warn(
        { hostId: args.hostId, providerId: args.providerId },
        "Provider usage did not answer in time for the fallback provider check",
      );
      return null;
    }
    return result;
  } catch (error) {
    deps.logger.warn(
      { err: error, hostId: args.hostId, providerId: args.providerId },
      "Could not read provider usage for the fallback provider check",
    );
    return null;
  } finally {
    clearTimeout(timer);
  }
}
