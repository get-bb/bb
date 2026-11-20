import { getAppSettings } from "@bb/db";
import {
  decideProviderFallback,
  type ProviderFallbackDecision,
} from "@bb/domain";
import type { LoggedWorkSessionDeps } from "../../types.js";
import { getProviderUsageLimits } from "../system/usage-limits.js";

async function readProviderUsage(
  deps: LoggedWorkSessionDeps,
  args: { hostId: string; providerId: string },
) {
  return (await getProviderUsageLimits(deps, args))[args.providerId] ?? null;
}

export async function resolveProviderFallback(
  deps: LoggedWorkSessionDeps,
  args: { hostId: string; providerId: string; model: string | null },
): Promise<ProviderFallbackDecision | null> {
  const fallbackProviderId = getAppSettings(deps.db).fallbackProviderId;
  if (fallbackProviderId === null || fallbackProviderId === args.providerId) {
    return null;
  }
  const registry = deps.providerRegistry;
  try {
    const providerUsage = await readProviderUsage(deps, args);
    const fallbackUsage =
      providerUsage?.status === "ok"
        ? await readProviderUsage(deps, {
            hostId: args.hostId,
            providerId: fallbackProviderId,
          })
        : null;
    return decideProviderFallback({
      providerId: args.providerId,
      model: args.model,
      fallbackProviderId,
      fallbackSelectable:
        !registry.disabledProviderIds().has(fallbackProviderId) &&
        registry.get(fallbackProviderId)?.info.available === true,
      providerUsage,
      fallbackUsage,
      now: Date.now(),
    });
  } catch (error) {
    deps.logger.warn(
      { err: error, hostId: args.hostId, providerId: args.providerId },
      "Could not read provider usage for the fallback provider check",
    );
    return null;
  }
}
