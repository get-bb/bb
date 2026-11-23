import { useState } from "react";
import { useAtom, useAtomValue } from "jotai";
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
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { useDesktopUpdateInfo } from "@/hooks/useDesktopUpdateInfo";
import { useMachineAttention } from "@/hooks/useMachineAttention";
import { useStartPluginUpdates } from "@/hooks/useStartPluginUpdates";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import { getProviderIconInfo } from "@/lib/provider-icon";
import {
  buildSidebarUpdateModel,
  type SidebarBbUpdate,
  type SidebarUpdateModel,
  type SidebarUpdateRow,
} from "./sidebar-update-model";
import {
  showProviderCliUpdatesAtom,
  skippedSidebarUpdatesAtom,
} from "./sidebar-update-preferences";
import { getSettingsTargetPath } from "@/components/settings/settings-sections";

interface SidebarUpdatesBadgeProps {
  onNavigate?: () => void;
}

export function SidebarUpdatesBadge({ onNavigate }: SidebarUpdatesBadgeProps) {
  const inventory = useUpdateInventory();
  const showProviderCliUpdates = useAtomValue(showProviderCliUpdatesAtom);
  const [skippedFingerprints, setSkippedFingerprints] = useAtom(
    skippedSidebarUpdatesAtom,
  );
  const providers = useSystemProviders().data;
  const appUpdate = useAppUpdateStatus().data;
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
  const bbNeedsAttention =
    inventory.appUpdateAvailable || inventory.desktopUpdateReady;
  const bb: SidebarBbUpdate | null =
    bbNeedsAttention || serverCanApply
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
          installsWhenIdle: serverCanApply && appUpdate.autoUpdate,
          restarting:
            appUpdate !== undefined && appUpdate.activity.phase !== "idle",
          canRestart: serverCanApply || desktopCanRelaunch,
        }
      : null;
  const model = buildSidebarUpdateModel({
    bb,
    bbFingerprint:
      bb === null || !bbNeedsAttention
        ? null
        : `bb:${appUpdate?.available?.version ?? bb.version ?? "unknown"}`,
    skippedFingerprints,
    machines: inventory.machines,
    plugins: inventory.plugins,
    showProviderCliUpdates,
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
              to={getSettingsTargetPath({ section: "machines" })}
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
      {model.visible ? (
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
            onSkip={() => setSkippedFingerprints(model.fingerprints)}
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
  onSkip: () => void;
}

export function SidebarUpdateButton({
  model,
  providers,
  restartPending,
  onNavigate,
  onUpdateAll,
  onRestartBb,
  onSkip,
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
      onSkip={() => {
        setTapOpen(false);
        onSkip();
      }}
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
          className={UPDATE_CARD_CLASS}
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
            to={getSettingsTargetPath({ section: "updates" })}
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
        className={UPDATE_CARD_CLASS}
      >
        {cardBody}
      </HoverCardContent>
    </HoverCard>
  );
}

const UPDATE_CARD_CLASS =
  "w-76 p-3 text-xs max-md:pointer-coarse:px-4 max-md:pointer-coarse:pb-4";

const UPDATE_CARD_ICON_CLASS = "size-3.5 max-md:pointer-coarse:size-4";

const UPDATE_CARD_LINK_CLASS = cn(
  "shrink-0 cursor-pointer text-foreground underline decoration-muted-foreground/60 underline-offset-3 hover:decoration-current",
  "max-md:pointer-coarse:-my-3 max-md:pointer-coarse:py-3",
);

const UPDATE_CARD_BUTTON_CLASS =
  "mt-3 h-7 w-full max-md:pointer-coarse:mt-4 max-md:pointer-coarse:h-9";

const UPDATE_BUTTON_CLASS = cn(
  SIDEBAR_FOOTER_ACTION_CLASS,
  "rounded-full bg-sidebar-accent text-sidebar-foreground [&>[data-icon-root]]:opacity-100",
  "hover:bg-sidebar-border hover:text-sidebar-foreground active:bg-sidebar-border",
);

export function sidebarUpdateAllLabel(model: SidebarUpdateModel): string {
  if (model.startableCount === 0) return "Updating…";
  if (model.retryOnly) return "Try again";
  const startable = model.rows.filter((row) =>
    row.kind === "provider" ? row.start !== null : row.startable,
  );
  const count = startable.length;
  const hasProviders = startable.some((row) => row.kind === "provider");
  const hasPlugins = startable.some((row) => row.kind === "plugin");
  const noun =
    hasProviders && hasPlugins
      ? "CLIs and plugins"
      : hasProviders
        ? count === 1
          ? "agent CLI"
          : "agent CLIs"
        : count === 1
          ? "plugin"
          : "plugins";
  return `Update ${String(count)} ${noun}`;
}

function SidebarUpdateCardBody({
  model,
  providers,
  restartPending,
  onDetails,
  onUpdateAll,
  onRestartBb,
  onSkip,
}: {
  model: SidebarUpdateModel;
  providers: readonly ProviderInfo[] | null;
  restartPending: boolean;
  onDetails: () => void;
  onUpdateAll: () => void;
  onRestartBb: () => void;
  onSkip: () => void;
}) {
  return (
    <>
      <div className="mb-3 flex items-center gap-3 text-muted-foreground max-md:pointer-coarse:mb-4">
        <span className="min-w-0 flex-1 truncate">
          {sidebarUpdateButtonLabel(model)}
        </span>
        <Link
          to={getSettingsTargetPath({ section: "updates" })}
          onClick={onDetails}
          className={UPDATE_CARD_LINK_CLASS}
        >
          Details
        </Link>
        {model.updating ? null : (
          <button
            type="button"
            onClick={onSkip}
            className={UPDATE_CARD_LINK_CLASS}
          >
            Skip
          </button>
        )}
      </div>
      {model.bb === null ? null : (
        <SidebarBbUpdateSection
          bb={model.bb}
          restartPending={restartPending}
          onRestart={onRestartBb}
        />
      )}
      {model.bb !== null && model.rows.length > 0 ? (
        <div className="-mx-3 my-3 border-t border-border max-md:pointer-coarse:-mx-4" />
      ) : null}
      {model.rows.length === 0 ? null : (
        <>
          <ul className="space-y-0.5" aria-label="Updates">
            {model.rows.map((row) => (
              <SidebarUpdateRowItem
                key={row.key}
                row={row}
                providers={providers}
              />
            ))}
          </ul>
          <Button
            size="sm"
            className={UPDATE_CARD_BUTTON_CLASS}
            disabled={model.startableCount === 0}
            onClick={onUpdateAll}
          >
            {sidebarUpdateAllLabel(model)}
          </Button>
        </>
      )}
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
      <div className="flex items-center gap-1.5 max-md:pointer-coarse:gap-2">
        <BbLogo className={UPDATE_CARD_ICON_CLASS} />
        <span className="text-sm font-medium max-md:pointer-coarse:text-base">
          {bb.version === null ? "bb update" : `bb ${bb.version}`}
        </span>
        {bb.currentVersion === null || bb.version === null ? null : (
          <span className="truncate font-mono text-muted-foreground">
            from {bb.currentVersion}
          </span>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-muted-foreground max-md:pointer-coarse:gap-2">
        <Icon
          name={bb.restarting ? "Loading" : "Clock"}
          className={cn(
            "size-3 shrink-0 max-md:pointer-coarse:size-3.5",
            bb.restarting && "animate-spin",
          )}
        />
        <span className="min-w-0 flex-1 truncate">
          {bb.restarting
            ? "Restarting into the update…"
            : bb.installsWhenIdle
              ? "Installs itself when you're idle"
              : "Installs when bb restarts"}
        </span>
      </div>
      {!bb.canRestart || bb.restarting ? null : (
        <Button
          variant="outline"
          size="sm"
          className={UPDATE_CARD_BUTTON_CLASS}
          disabled={restartPending}
          onClick={onRestart}
        >
          {bb.version === null
            ? "Restart bb now"
            : `Restart into bb ${bb.version} now`}
        </Button>
      )}
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
        "flex h-6 items-center gap-2 max-md:pointer-coarse:h-8",
        row.state === "failed" && "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          UPDATE_CARD_ICON_CLASS,
          "flex shrink-0 items-center justify-center",
        )}
      >
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
            className={UPDATE_CARD_ICON_CLASS}
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
    <iconInfo.icon className={UPDATE_CARD_ICON_CLASS} />
  ) : (
    <ProviderIconMark
      provider={provider}
      icon={iconInfo.icon}
      className={UPDATE_CARD_ICON_CLASS}
    />
  );
}
