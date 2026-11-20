import { useQuery } from "@tanstack/react-query";
import {
  decideProviderFallback,
  type ProviderFallbackDecision,
} from "@bb/domain";
import { systemProviderUsageQueryKey } from "@/hooks/queries/query-keys";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { sdk } from "@/lib/sdk";

const PROVIDER_USAGE_STALE_MS = 60_000;

function useProviderUsage(args: {
  enabled: boolean;
  hostId: string | null;
  providerId: string;
}) {
  return useQuery({
    queryKey: systemProviderUsageQueryKey(args),
    queryFn: async ({ signal }) =>
      (
        await sdk.system.usageLimits({
          ...(args.hostId === null ? {} : { hostId: args.hostId }),
          providerId: args.providerId,
          signal,
        })
      )[args.providerId] ?? null,
    enabled: args.enabled,
    staleTime: PROVIDER_USAGE_STALE_MS,
    refetchInterval: PROVIDER_USAGE_STALE_MS,
  });
}

export function useNewThreadProviderFallback(args: {
  enabled: boolean;
  hostId: string | null;
  providerId: string;
  model: string | null;
  fallbackSelectable: (providerId: string) => boolean;
}): ProviderFallbackDecision | null {
  const fallbackProviderId =
    useSystemConfig().data?.generalSettings.fallbackProviderId ?? null;
  const active =
    args.enabled &&
    args.providerId.length > 0 &&
    fallbackProviderId !== null &&
    fallbackProviderId !== args.providerId;
  const providerUsage = useProviderUsage({
    enabled: active,
    hostId: args.hostId,
    providerId: args.providerId,
  });
  const fallbackUsage = useProviderUsage({
    enabled: active && providerUsage.data?.status === "ok",
    hostId: args.hostId,
    providerId: fallbackProviderId ?? "",
  });
  if (!active || fallbackProviderId === null) return null;
  const measuredAt = Math.max(
    providerUsage.dataUpdatedAt,
    fallbackUsage.dataUpdatedAt,
  );
  return decideProviderFallback({
    providerId: args.providerId,
    model: args.model,
    fallbackProviderId,
    fallbackSelectable: args.fallbackSelectable(fallbackProviderId),
    providerUsage: providerUsage.data ?? null,
    fallbackUsage: fallbackUsage.data ?? null,
    now: measuredAt,
  });
}
