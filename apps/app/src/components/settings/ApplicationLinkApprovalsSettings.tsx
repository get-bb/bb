import { appQueryClient } from "@/lib/app-query-client";
import { applicationLinkApprovalsQueryKey } from "@/hooks/cache-owners/application-link-approvals-cache-owner";
import { useQuery } from "@tanstack/react-query";
import { useId } from "react";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { applicationLinkApprovals } from "@/lib/application-url";
import { appToast } from "@/components/ui/app-toast";
import { SettingsWithControl } from "@/components/ui/settings-section";

export function ApplicationLinkApprovalsSettings() {
  const listLabelId = useId();
  const approvals = useQuery(
    {
      queryKey: applicationLinkApprovalsQueryKey,
      queryFn: applicationLinkApprovals.list,
      staleTime: 0,
      refetchOnWindowFocus: true,
    },
    appQueryClient,
  );
  const revoke = async (scheme: string) => {
    try {
      await applicationLinkApprovals.revoke(scheme);
    } catch (error) {
      appToast.error("Couldn't remove app link approval", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  };
  return (
    <div className="border-border not-first:border-t not-first:pt-5">
      <SettingsWithControl
        label="App links"
        description="BB asks before opening links like linear:// in another app. Approvals stay on this device and aren't synced."
        controlPlacement="below"
      >
        {approvals.isPending ? (
          <p className="text-xs text-subtle-foreground">Loading…</p>
        ) : approvals.isError ? (
          <p className="text-xs text-destructive-text">
            {approvals.error.message}
          </p>
        ) : approvals.data.length === 0 ? (
          <p className="text-xs text-subtle-foreground">
            No apps are always allowed.
          </p>
        ) : (
          <div className="space-y-1">
            <p
              id={listLabelId}
              className="text-xs font-medium text-subtle-foreground"
            >
              Always allowed
            </p>
            <ul
              aria-labelledby={listLabelId}
              className="divide-y divide-border"
            >
              {approvals.data.map((scheme) => (
                <li
                  key={scheme}
                  className="flex items-center justify-between gap-3 py-1"
                >
                  <span className="min-w-0 truncate font-mono text-sm">
                    {scheme}:
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="-mr-2 size-8 shrink-0 text-subtle-foreground"
                    aria-label={`Remove ${scheme} approval`}
                    onClick={() => {
                      void revoke(scheme);
                    }}
                  >
                    <Icon name="Trash2" className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </SettingsWithControl>
    </div>
  );
}
