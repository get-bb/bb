import { useState } from "react";
import { Link } from "react-router-dom";
import type { ProviderInfo } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@bb/shared-ui/hover-card";
import { Icon } from "@bb/shared-ui/icon";
import { Popover, PopoverContent, PopoverTrigger } from "@bb/shared-ui/popover";
import { useResponsiveOverlayBehavior } from "@bb/shared-ui/responsive-overlay";
import { cn } from "@bb/shared-ui/lib/utils";
import { formatAppUpdateRevision } from "@/components/app-update/app-update-presentation";
import { useStartAppUpdate } from "@/components/app-update/useStartAppUpdate";
import { PluginIcon } from "@/components/plugin/PluginIcon";
import { useProviderCliInstallRunner } from "@/components/provider-cli/provider-cli-install";
import { resolveReleaseUpdateVersion } from "@/components/settings/release-notes-model";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import { BbLogo } from "@/components/ui/bb-logo";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "@bb/shared-ui/sidebar-row-classes";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar.js";
import { useAppUpdateStatus } from "@/hooks/queries/app-update-queries";
import { usePluginUpdateJobs } from "@/hooks/queries/plugin-update-job-queries";
import {
  useSystemConfig,
  useSystemProviders,
} from "@/hooks/queries/system-queries";
import { useDesktopUpdateInfo } from "@/hooks/useDesktopUpdateInfo";
import { useMachineAttention } from "@/hooks/useMachineAttention";
import { useStartPluginUpdates } from "@/hooks/useStartPluginUpdates";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { getSettingsRoutePath } from "@/lib/route-paths";
import {
  buildSidebarUpdateModel,
  sidebarUpdateModelIsEmpty,
  type SidebarBbUpdate,
  type SidebarUpdateModel,
  type SidebarUpdateRow,
} from "./sidebar-update-model";

interface SidebarUpdatesBadgeProps {
  onNavigate?: () => void;
}

export function SidebarUpdatesBadge({ onNavigate }: SidebarUpdatesBadgeProps) {
  const inventory = useUpdateInventory();
  const providers = useSystemProviders().data;
  const appUpdate = useAppUpdateStatus().data;
  const updateWhenIdle =
    useSystemConfig().data?.experiments.updateWhenIdle === true;
  const { desktopApi, isDesktop } = useDesktopUpdateInfo();
  const providerJobs = useProviderCliInstallRunner();
  const pluginJobs = usePluginUpdateJobs().data ?? [];
  const startPluginUpdates = useStartPluginUpdates(inventory.plugins);
  const appUpdateStart = useStartAppUpdate();
  const machineAttention = useMachineAttention(
    inventory.machines.map((machine) => machine.host),
    inventory.isLoading,
  );

  const serverCanApply =
    appUpdate !== undefined &&
    appUpdate.available !== null &&
    appUpdate.blocked === null &&
    (appUpdate.support.kind === "supported" ||
      appUpdate.desktopUpdateSupported === true);
  const desktopCanRelaunch =
    inventory.desktopUpdateReady && desktopApi !== null;
  const bb: SidebarBbUpdate | null =
    inventory.appUpdateAvailable || inventory.desktopUpdateReady
      ? {
          version:
            appUpdate?.available != null
              ? formatAppUpdateRevision(appUpdate.available)
              : resolveReleaseUpdateVersion({
                  isDesktop,
                  desktopInfo: inventory.desktopInfo,
                  appUpdate,
                  systemVersion: inventory.systemVersion,
                }),
          currentVersion:
            appUpdate !== undefined
              ? formatAppUpdateRevision(appUpdate.current)
              : (inventory.desktopInfo?.version ??
                inventory.systemVersion?.currentVersion ??
                null),
          installsWhenIdle:
            serverCanApply && updateWhenIdle && appUpdate.autoUpdate,
          restarting:
            appUpdate !== undefined && appUpdate.activity.phase !== "idle",
          restartLabel:
            serverCanApply || desktopCanRelaunch ? "Restart now" : null,
        }
      : null;
  const model = buildSidebarUpdateModel({
    bb,
    machines: inventory.machines,
    plugins: inventory.plugins,
    providerJobs,
    pluginJobs,
  });

  function updateAll(): void {
    const pluginIds: string[] = [];
    for (const row of model.rows) {
      if (row.kind === "provider") {
        if (row.start !== null) providerJobs.startInstall(row.start);
      } else if (row.startable) {
        pluginIds.push(row.pluginId);
      }
    }
    if (pluginIds.length > 0) startPluginUpdates(pluginIds);
  }

  function restartBb(): void {
    if (serverCanApply) {
      appUpdateStart.start();
    } else if (desktopApi !== null) {
      void desktopApi.installUpdate();
    }
  }

  const showUpdates = !sidebarUpdateModelIsEmpty(model);
  return (
    <>
      {machineAttention.label !== null ? (
        <SidebarMenuItem className="ml-auto shrink-0">
          <SidebarMenuButton
            asChild
            aria-label={machineAttention.label}
            tooltip={{
              children: machineAttention.label,
              hidden: false,
              side: "top",
            }}
            className={cn(
              SIDEBAR_FOOTER_ACTION_CLASS,
              "text-warning-text hover:text-warning-text",
            )}
          >
            <Link
              to={getSettingsRoutePath("machines")}
              onClick={() => {
                machineAttention.acknowledge();
                onNavigate?.();
              }}
              data-testid="sidebar-machines-attention-badge"
            >
              <Icon name="AlertTriangle" />
            </Link>
          </SidebarMenuButton>
        </SidebarMenuItem>
      ) : null}
      {showUpdates ? (
        <SidebarMenuItem
          className={cn(
            "shrink-0",
            machineAttention.label === null && "ml-auto",
          )}
        >
          <SidebarUpdateButton
            model={model}
            providers={providers ?? null}
            restartPending={appUpdateStart.pending}
            onNavigate={onNavigate}
            onUpdateAll={updateAll}
            onRestartBb={restartBb}
          />
          {appUpdateStart.confirmDialog}
        </SidebarMenuItem>
      ) : null}
    </>
  );
}

export function sidebarUpdateButtonLabel(model: SidebarUpdateModel): string {
  if (model.updating) return "Updating";
  const count = model.rows.length + (model.bb === null ? 0 : 1);
  return count === 1 ? "1 update available" : `${count} updates available`;
}

interface SidebarUpdateButtonProps {
  model: SidebarUpdateModel;
  providers: readonly ProviderInfo[] | null;
  restartPending: boolean;
  onNavigate?: () => void;
  onUpdateAll: () => void;
  onRestartBb: () => void;
}

export function SidebarUpdateButton({
  model,
  providers,
  restartPending,
  onNavigate,
  onUpdateAll,
  onRestartBb,
}: SidebarUpdateButtonProps) {
  const { supportsHover } = useResponsiveOverlayBehavior();
  const [tapOpen, setTapOpen] = useState(false);
  const label = sidebarUpdateButtonLabel(model);
  const icon = (
    <Icon
      name={model.updating ? "Loading" : "Download"}
      className={cn(model.updating && "animate-spin")}
    />
  );
  const cardBody = (
    <SidebarUpdateCardBody
      model={model}
      providers={providers}
      restartPending={restartPending}
      onDetails={() => {
        setTapOpen(false);
        onNavigate?.();
      }}
      onUpdateAll={onUpdateAll}
      onRestartBb={onRestartBb}
    />
  );

  if (!supportsHover) {
    return (
      <Popover open={tapOpen} onOpenChange={setTapOpen}>
        <PopoverTrigger asChild>
          <SidebarMenuButton
            aria-label={label}
            data-testid="sidebar-update-button"
            data-updating={model.updating || undefined}
            className={UPDATE_BUTTON_CLASS}
          >
            {icon}
          </SidebarMenuButton>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          mobileTitle="Updates"
          data-testid="sidebar-update-card"
          className="w-76 p-3 text-xs"
        >
          {cardBody}
        </PopoverContent>
      </Popover>
    );
  }

  return (
    <HoverCard openDelay={150} closeDelay={200}>
      <HoverCardTrigger asChild>
        <SidebarMenuButton asChild className={UPDATE_BUTTON_CLASS}>
          <Link
            to={getSettingsRoutePath("updates")}
            onClick={onNavigate}
            aria-label={label}
            data-testid="sidebar-update-button"
            data-updating={model.updating || undefined}
          >
            {icon}
          </Link>
        </SidebarMenuButton>
      </HoverCardTrigger>
      <HoverCardContent
        side="top"
        align="end"
        sideOffset={8}
        data-testid="sidebar-update-card"
        className="w-76 p-3 text-xs"
      >
        {cardBody}
      </HoverCardContent>
    </HoverCard>
  );
}

const UPDATE_BUTTON_CLASS = cn(
  SIDEBAR_FOOTER_ACTION_CLASS,
  "rounded-full bg-sidebar-accent text-sidebar-foreground [&>[data-icon-root]]:opacity-100",
  "hover:bg-sidebar-border hover:text-sidebar-foreground active:bg-sidebar-border",
);

function SidebarUpdateCardBody({
  model,
  providers,
  restartPending,
  onDetails,
  onUpdateAll,
  onRestartBb,
}: {
  model: SidebarUpdateModel;
  providers: readonly ProviderInfo[] | null;
  restartPending: boolean;
  onDetails: () => void;
  onUpdateAll: () => void;
  onRestartBb: () => void;
}) {
  return (
    <>
      {model.bb === null ? null : (
        <SidebarBbUpdateSection
          bb={model.bb}
          restartPending={restartPending}
          onRestart={onRestartBb}
        />
      )}
      {model.bb !== null && model.rows.length > 0 ? (
        <div className="-mx-3 my-3 border-t border-border" />
      ) : null}
      {model.rows.length === 0 ? null : (
        <ul className="space-y-0.5" aria-label="Updates">
          {model.rows.map((row) => (
            <SidebarUpdateRowItem
              key={row.key}
              row={row}
              providers={providers}
            />
          ))}
        </ul>
      )}
      <div className="mt-3 flex gap-2">
        <Button asChild variant="outline" size="sm" className="h-7 flex-1">
          <Link to={getSettingsRoutePath("updates")} onClick={onDetails}>
            Details
          </Link>
        </Button>
        {model.rows.length === 0 ? null : (
          <Button
            size="sm"
            className="h-7 flex-1"
            disabled={model.startableCount === 0}
            onClick={onUpdateAll}
          >
            {model.startableCount === 0
              ? "Updating…"
              : model.retryOnly
                ? "Try again"
                : model.startableCount === model.rows.length
                  ? "Update all"
                  : `Update ${String(model.startableCount)}`}
          </Button>
        )}
      </div>
    </>
  );
}

function SidebarBbUpdateSection({
  bb,
  restartPending,
  onRestart,
}: {
  bb: SidebarBbUpdate;
  restartPending: boolean;
  onRestart: () => void;
}) {
  return (
    <section aria-label="bb update">
      <div className="flex items-center gap-1.5">
        <BbLogo className="size-3.5" />
        <span className="text-sm font-medium">
          {bb.version === null ? "bb update" : `bb ${bb.version}`}
        </span>
        {bb.currentVersion === null || bb.version === null ? null : (
          <span className="truncate font-mono text-muted-foreground">
            from {bb.currentVersion}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-muted-foreground">
        <Icon
          name={bb.restarting ? "Loading" : "Clock"}
          className={cn("size-3 shrink-0", bb.restarting && "animate-spin")}
        />
        <span className="min-w-0 flex-1 truncate">
          {bb.restarting
            ? "Restarting into the update…"
            : bb.installsWhenIdle
              ? "Installs itself when you're idle"
              : "Installs when bb restarts"}
        </span>
        {bb.restartLabel === null || bb.restarting ? null : (
          <button
            type="button"
            disabled={restartPending}
            onClick={onRestart}
            className="shrink-0 cursor-pointer text-foreground underline decoration-muted-foreground/60 underline-offset-3 hover:decoration-current disabled:opacity-50"
          >
            {bb.restartLabel}
          </button>
        )}
      </div>
    </section>
  );
}

function SidebarUpdateRowItem({
  row,
  providers,
}: {
  row: SidebarUpdateRow;
  providers: readonly ProviderInfo[] | null;
}) {
  return (
    <li
      data-update-row={row.key}
      data-state={row.state}
      className={cn(
        "flex h-6 items-center gap-2",
        row.state === "failed" && "text-muted-foreground",
      )}
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center">
        {row.kind === "provider" ? (
          <SidebarProviderMark
            providerId={row.provider}
            providers={providers}
          />
        ) : (
          <PluginIcon
            pluginId={row.pluginId}
            icon={row.icon}
            fallbackIcon="Plug02"
            className="size-3.5"
          />
        )}
      </span>
      <span className="min-w-0 truncate">{row.label}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1 text-muted-foreground tabular-nums">
        {row.state === "updating" ? (
          <>
            <Icon name="Loading" className="size-3 animate-spin" />
            Updating
          </>
        ) : row.state === "failed" ? (
          "Failed · try again"
        ) : (
          row.detail
        )}
      </span>
    </li>
  );
}

function SidebarProviderMark({
  providerId,
  providers,
}: {
  providerId: string;
  providers: readonly ProviderInfo[] | null;
}) {
  const provider =
    providers?.find((candidate) => candidate.id === providerId) ?? null;
  const iconInfo = getProviderIconInfo("agent", providerId, provider);
  if (iconInfo === undefined) return null;
  return provider === null ? (
    <iconInfo.icon className="size-3.5" />
  ) : (
    <ProviderIconMark
      provider={provider}
      icon={iconInfo.icon}
      className="size-3.5"
    />
  );
}
