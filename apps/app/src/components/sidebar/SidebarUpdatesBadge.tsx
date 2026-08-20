import { Link } from "react-router-dom";
import type { ProviderCliKey } from "@bb/host-daemon-contract";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import { SidebarMenuItem } from "@/components/ui/sidebar.js";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import {
  getProviderIconColorClass,
  getProviderIconInfo,
} from "@/lib/provider-icon";
import { getSettingsRoutePath } from "@/lib/route-paths";

export interface SidebarUpdatesBadgeProps {
  onNavigate?: () => void;
}

const CHIP_CLASS = cn(
  "flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-sidebar-border px-2",
  "text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
);

function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

interface StaleProvider {
  provider: ProviderCliKey;
  displayName: string;
}

/**
 * The quiet update affordance (BB-48): small outlined chips in the sidebar
 * footer's lower-right corner, rendered only while an update needs attention.
 * Updates split into the two buckets a user acts on separately — bb itself
 * (app release, downloaded desktop update, or a daemon stuck on an old
 * protocol) and the agent CLIs, which carry their own brand marks so it is
 * clear which agent is stale without hovering. Both chips open the
 * consolidated Settings → Updates view.
 *
 * A CLI that is not installed at all is not an update and gets no chip here:
 * there is no installed version to stale against, and the Settings → Updates
 * page already surfaces the install prompt for it.
 */
export function SidebarUpdatesBadge({ onNavigate }: SidebarUpdatesBadgeProps) {
  const inventory = useUpdateInventory();

  const stuckDaemonCount = inventory.machines.filter(
    (machine) => machine.canRetryDaemonUpdate,
  ).length;
  const bbUpdateCount =
    (inventory.appUpdateAvailable ? 1 : 0) +
    (inventory.desktopUpdateReady ? 1 : 0) +
    stuckDaemonCount;

  // One mark per provider, even when the same CLI is stale on several machines.
  // Missing CLIs are install prompts, not updates: skip them so the chip never
  // claims an update is available for a CLI that isn't installed.
  const staleProvidersByKey = new Map<ProviderCliKey, StaleProvider>();
  for (const machine of inventory.machines) {
    for (const issue of machine.issues) {
      if (!issue.status.installed) {
        continue;
      }
      if (!staleProvidersByKey.has(issue.provider)) {
        staleProvidersByKey.set(issue.provider, {
          provider: issue.provider,
          displayName: issue.status.displayName,
        });
      }
    }
  }
  const staleProviders = [...staleProvidersByKey.values()];

  if (bbUpdateCount === 0 && staleProviders.length === 0) {
    return null;
  }

  const updatesRoutePath = getSettingsRoutePath("updates");
  const bbLabel =
    bbUpdateCount === 1 ? "bb update available" : "bb updates available";
  const providerLabel = `${joinNames(
    staleProviders.map((stale) => stale.displayName),
  )} ${staleProviders.length === 1 ? "update" : "updates"} available`;

  return (
    // Right-alignment on a single row comes from the flexible spacer the
    // sidebar footer renders before this item, not from a margin here — a
    // margin would also push the chips right on their own wrapped line.
    <SidebarMenuItem className="flex min-w-0 items-center gap-1">
      {bbUpdateCount > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={updatesRoutePath}
              onClick={onNavigate}
              aria-label={bbLabel}
              data-testid="sidebar-updates-badge-bb"
              className={CHIP_CLASS}
            >
              <Icon name="Download" className="size-3 text-muted-foreground" />
              bb
            </Link>
          </TooltipTrigger>
          <TooltipContent side="top">{bbLabel}</TooltipContent>
        </Tooltip>
      ) : null}
      {staleProviders.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={updatesRoutePath}
              onClick={onNavigate}
              aria-label={providerLabel}
              data-testid="sidebar-updates-badge-providers"
              className={CHIP_CLASS}
            >
              <Icon name="Download" className="size-3 text-muted-foreground" />
              <span className="flex items-center gap-1">
                {staleProviders.map((stale) => {
                  const providerId = stale.provider;
                  const iconInfo = getProviderIconInfo(providerId);
                  if (iconInfo === undefined) {
                    return null;
                  }
                  const { icon: ProviderIcon } = iconInfo;
                  return (
                    <ProviderIcon
                      key={stale.provider}
                      className={cn(
                        "size-3",
                        getProviderIconColorClass(providerId),
                      )}
                    />
                  );
                })}
              </span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="top">{providerLabel}</TooltipContent>
        </Tooltip>
      ) : null}
    </SidebarMenuItem>
  );
}
