import {
  invalidateApplicationLinkApprovals,
  writeApplicationLinkApprovals,
} from "@/hooks/cache-owners/application-link-approvals-cache-owner";
import {
  createApplicationLinkApprovals,
  APPLICATION_LINK_APPROVALS_STORAGE_KEY,
} from "@bb/domain/application-link-approvals";
import { useQuery } from "@tanstack/react-query";
import { systemConfigQueryOptions } from "@/hooks/queries/system-queries";
import { appQueryClient } from "./app-query-client";
import {
  createApplicationUrlOpener,
  type ApplicationUrl,
  type ApplicationUrlDecision,
} from "@bb/domain/application-url";
import { getBbDesktopInfo } from "./bb-desktop";
import { getNativeShell } from "./native-shell";
import { appToast } from "@/components/ui/app-toast";

const deviceApprovals = createApplicationLinkApprovals({
  read: () =>
    window.localStorage.getItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY),
  write: (value) =>
    window.localStorage.setItem(APPLICATION_LINK_APPROVALS_STORAGE_KEY, value),
});

export const applicationLinkApprovals = {
  list: async () => deviceApprovals.list(),
  revoke: async (scheme: string | null) => {
    deviceApprovals.revoke(scheme);
    const remaining = deviceApprovals.list();
    writeApplicationLinkApprovals(appQueryClient, remaining);
    return remaining;
  },
};

let confirmation: {
  target: ApplicationUrl;
  resolve: (decision: ApplicationUrlDecision) => void;
} | null = null;
const listeners = new Set<() => void>();

export const getApplicationUrlConfirmation = () => confirmation;
export function subscribeApplicationUrlConfirmation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function resolveApplicationUrlConfirmation(
  decision: ApplicationUrlDecision,
) {
  const current = confirmation;
  confirmation = null;
  for (const listener of listeners) listener();
  current?.resolve(decision);
}

export function useApplicationLinksEnabled(): boolean {
  const { data } = useQuery(
    {
      ...systemConfigQueryOptions(),
      enabled: false,
      select: (config) => config.experiments.applicationLinks,
    },
    appQueryClient,
  );
  return data === true;
}

export function applicationLinksEnabled(): boolean {
  return (
    appQueryClient.getQueryData(systemConfigQueryOptions().queryKey)
      ?.experiments.applicationLinks === true
  );
}

const openConfirmedApplicationUrl = createApplicationUrlOpener({
  approvals: deviceApprovals,
  confirm: (target) =>
    new Promise<ApplicationUrlDecision>((resolve) => {
      confirmation = { target, resolve };
      for (const listener of listeners) listener();
    }),
  open: dispatchApplicationUrl,
});

export function openApplicationUrl(url: string): void {
  if (!applicationLinksEnabled()) return;
  void openConfirmedApplicationUrl(url)
    .finally(() => {
      invalidateApplicationLinkApprovals(appQueryClient);
    })
    .catch((error: unknown) => {
      appToast.error("Couldn't open application link", {
        description:
          error instanceof Error
            ? error.message
            : "Check that the destination app is installed.",
      });
    });
}

async function dispatchApplicationUrl(url: string): Promise<void> {
  const desktop = getBbDesktopInfo();
  if (desktop !== null) {
    if (!desktop.openApplicationUrl)
      throw new Error("Update the BB desktop app to open application links.");
    await desktop.openApplicationUrl(url);
    return;
  }
  const native = getNativeShell();
  if (native !== null) {
    if (native.handshake.bridgeVersion < 3)
      throw new Error("Update the BB mobile app to open application links.");
    await native.request("open-application", { url });
    return;
  }
  window.location.assign(url);
}
