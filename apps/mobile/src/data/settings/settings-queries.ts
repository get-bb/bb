import type { ProviderUsageResponse } from "@bb/host-daemon-contract";
import type {
  SystemCliSkillsStatusResponse,
  SystemInstallCliSkillsRequest,
  SystemInstallCliSkillsResponse,
  ThemeCatalogResponse,
} from "@bb/server-contract";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useProfileClient } from "@/app-shell/ProfilesProvider";
import {
  systemCliSkillsQueryKey,
  systemUsageLimitsQueryKey,
  themeCatalogQueryKey,
} from "@/lib/query/query-keys";
import { FOCUS_OWNED_LIVE_QUERY_POLICY } from "../shared/query-policies";
import { useSystemRealtimeSubscription } from "../shared/use-realtime-subscription";

interface QueryOptions {
  enabled?: boolean;
}

/**
 * `GET /settings/themes`: built-in ids live in `@bb/domain`; this adds the
 * custom themes on disk and plugin palettes. Refreshed on `config-changed` /
 * `plugins-changed` through the `system` subscription.
 */
export function useThemeCatalog(options?: QueryOptions) {
  const { sdk } = useProfileClient();
  const enabled = options?.enabled ?? true;
  useSystemRealtimeSubscription({ enabled });
  return useQuery<ThemeCatalogResponse>({
    queryKey: themeCatalogQueryKey(),
    queryFn: ({ signal }) => sdk.theme.catalog({ signal }),
    enabled,
    staleTime: 60_000,
  });
}

export interface UseSystemUsageLimitsArgs extends QueryOptions {
  /** Omit to read the primary machine (the route's default). */
  hostId?: string;
}

/** `GET /system/usage-limits?hostId=` — the machine's provider subscription usage. */
export function useSystemUsageLimits(args: UseSystemUsageLimitsArgs = {}) {
  const { sdk } = useProfileClient();
  const hostId = args.hostId ?? null;
  return useQuery<ProviderUsageResponse>({
    queryKey: systemUsageLimitsQueryKey(hostId),
    queryFn: ({ signal }) =>
      sdk.system.usageLimits({
        ...(args.hostId === undefined ? {} : { hostId: args.hostId }),
        signal,
      }),
    enabled: args.enabled ?? true,
    ...FOCUS_OWNED_LIVE_QUERY_POLICY,
  });
}

/** `GET /system/cli-skills`: per-machine install state of bb's built-in CLI skills. */
export function useCliSkillsStatus(options?: QueryOptions) {
  const { sdk } = useProfileClient();
  return useQuery<SystemCliSkillsStatusResponse>({
    queryKey: systemCliSkillsQueryKey(),
    queryFn: ({ signal }) => sdk.system.cliSkillsStatus({ signal }),
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  });
}

/**
 * Copy bb's built-in CLI skills into the chosen machines' global agent skill
 * roots (`POST /system/cli-skills/install`). A filesystem action on those
 * machines; the caller refetches the status afterwards.
 */
export function useInstallCliSkills() {
  const { sdk } = useProfileClient();
  return useMutation<
    SystemInstallCliSkillsResponse,
    Error,
    SystemInstallCliSkillsRequest
  >({
    meta: { errorMessage: "Failed to install the bb CLI skills." },
    mutationFn: (args) => sdk.system.installCliSkills(args),
  });
}
