import type { ReactNode } from "react";
import {
  ResourceDetailCollection,
  ResourceDetailListItem,
} from "@bb/shared-ui/resource-list";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@bb/shared-ui/tooltip";
import { formatAbsoluteDate } from "@/components/plugin/management/plugin-ui";
import type { PluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import {
  usePluginSettingsView,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { usePluginSlots, type PluginSlotSnapshot } from "@/lib/plugin-slots";
import { cn } from "@bb/shared-ui/lib/utils";

function pluginActivityIcon(
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null,
): { name: IconName; className: string; label: string } {
  if (state === "running" || state === "ok") {
    return {
      name: "CircleCheck",
      className: "text-success",
      label: "Healthy",
    };
  }
  if (state === "backoff") {
    return {
      name: "AlertTriangle",
      className: "text-warning",
      label: "Retrying",
    };
  }
  if (state === "error") {
    return { name: "CircleX", className: "text-destructive", label: "Failed" };
  }
  if (state === null) {
    return {
      name: "Clock",
      className: "text-muted-foreground",
      label: "No runs yet",
    };
  }
  return {
    name: "Pause",
    className: "text-muted-foreground",
    label: "Stopped",
  };
}

export function PluginActivityState({
  state,
  resourceLabel,
}: {
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null;
  resourceLabel: string;
}) {
  const icon = pluginActivityIcon(state);
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={`${resourceLabel}: ${icon.label}`}
            className="inline-flex"
          >
            <Icon
              name={icon.name}
              className={cn("size-4", icon.className)}
              aria-hidden
            />
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">{icon.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface PluginCapabilityItem {
  key: string;
  label: ReactNode;
  detail?: ReactNode;
  mono?: boolean;
}

export function capabilityDetail(kind: string, id?: string): ReactNode {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span>{kind}</span>
      {id ? <span className="break-all font-mono">{id}</span> : null}
    </span>
  );
}

export function namedSurface(
  prefix: string,
  id: string,
  title: string | undefined,
  kind: string,
): PluginCapabilityItem {
  const label = title?.trim() || id;
  return {
    key: `${prefix}:${id}`,
    label,
    detail: capabilityDetail(kind, label === id ? undefined : id),
    mono: label === id,
  };
}

export function pluginAppSurfaceItems(
  pluginId: string,
  slots: PluginSlotSnapshot,
): PluginCapabilityItem[] {
  return [
    ...slots.navPanels
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) =>
        namedSurface("nav", slot.id, slot.title, "Navigation panel"),
      ),
    ...slots.homepageSections
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) =>
        namedSurface("homepage", slot.id, slot.title, "Homepage section"),
      ),
    ...slots.threadPanelActions
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) =>
        namedSurface(
          "thread-panel",
          slot.id,
          slot.title,
          "Thread panel action",
        ),
      ),
    ...slots.composerCustomizations
      .filter((slot) => slot.pluginId === pluginId)
      .flatMap((slot) => [
        ...(slot.actions ?? []).map((action) =>
          namedSurface(
            `composer:${slot.id}:action`,
            action.id,
            undefined,
            "Composer action",
          ),
        ),
        ...(slot.banners ?? []).map((banner) =>
          namedSurface(
            `composer:${slot.id}:banner`,
            banner.id,
            undefined,
            "Composer banner",
          ),
        ),
        ...(slot.plusMenu ?? []).map((item) =>
          namedSurface(
            `composer:${slot.id}:plus-menu`,
            item.id,
            item.label,
            "Composer plus-menu item",
          ),
        ),
        ...(slot.richText?.effects ?? []).map((effect) =>
          namedSurface(
            `composer:${slot.id}:rich-text`,
            effect.id,
            undefined,
            "Composer text effect",
          ),
        ),
      ]),
    ...slots.pendingInteractions
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) =>
        namedSurface("input", slot.id, undefined, "Input renderer"),
      ),
    ...slots.sidebarFooterActions
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) =>
        namedSurface("sidebar", slot.id, slot.title, "Sidebar action"),
      ),
    ...slots.fileOpeners
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) => ({
        ...namedSurface("file", slot.id, slot.title, "File opener"),
        detail: (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span>File opener</span>
            <span className="font-mono">
              {slot.extensions.map((extension) => `.${extension}`).join(", ")}
            </span>
          </span>
        ),
      })),
    ...slots.messageDirectives
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) => ({
        key: `directive:${slot.id}`,
        label: `::${slot.id}`,
        detail: "Message renderer",
        mono: true,
      })),
    ...slots.messageActions
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) =>
        namedSurface("message-action", slot.id, slot.title, "Message action"),
      ),
  ];
}

export function PluginCapabilityGroup({
  icon,
  label,
  items,
}: {
  icon: IconName;
  label: string;
  items: readonly PluginCapabilityItem[];
}) {
  return (
    <ResourceDetailListItem
      className="items-start px-3 py-3"
      leading={
        <Icon
          name={icon}
          className="mt-0.5 size-4 text-muted-foreground"
          aria-hidden
        />
      }
    >
      <span data-plugin-capability-group className="block font-medium">
        {label}
      </span>
      <ul className="mt-2.5 space-y-2.5">
        {items.map((item) => (
          <li key={item.key} className="min-w-0">
            <span
              className={cn(
                "block break-words text-sm leading-snug text-foreground",
                item.mono && "break-all font-mono",
              )}
            >
              {item.label}
            </span>
            {item.detail ? (
              <span className="mt-0.5 block min-w-0 break-words text-xs leading-relaxed text-muted-foreground">
                {item.detail}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </ResourceDetailListItem>
  );
}

export function PluginIncludes({
  plugin,
  hasSettings,
}: {
  plugin: PluginListItem;
  hasSettings: boolean;
}) {
  const slots = usePluginSlots();
  const settingsQuery = usePluginSettingsView(plugin.id, {
    enabled: plugin.hasSettings,
  });
  const settingsSections = slots.settingsSections.filter(
    (slot) => slot.pluginId === plugin.id,
  );
  const appItems = pluginAppSurfaceItems(plugin.id, slots);
  if (
    plugin.app.hasApp &&
    appItems.length === 0 &&
    settingsSections.length === 0
  ) {
    appItems.push({
      key: "frontend-app",
      label: "Frontend app",
      detail: "Surface names are available while the plugin app is loaded",
    });
  }

  const settingsItems: PluginCapabilityItem[] = [
    ...Object.entries(settingsQuery.data?.schema ?? {}).map(
      ([key, descriptor]) => ({
        key: `setting:${key}`,
        label: descriptor.label,
        detail: capabilityDetail("Setting", key),
      }),
    ),
    ...settingsSections.map((slot) =>
      namedSurface(
        "settings-section",
        slot.id,
        slot.title,
        "Custom settings section",
      ),
    ),
  ];
  if (hasSettings && settingsItems.length === 0) {
    settingsItems.push({
      key: "settings",
      label: "Configurable behavior",
      detail: settingsQuery.isLoading
        ? "Loading setting names…"
        : "Setting names are unavailable",
    });
  }

  return (
    <ResourceDetailCollection>
      {appItems.length > 0 ? (
        <PluginCapabilityGroup
          icon="AppWindow"
          label="App surfaces"
          items={appItems}
        />
      ) : null}
      {plugin.cliCommand ? (
        <PluginCapabilityGroup
          icon="Terminal"
          label="Command"
          items={[
            {
              key: plugin.cliCommand.name,
              label: `bb ${plugin.cliCommand.name}`,
              detail: plugin.cliCommand.summary || undefined,
              mono: true,
            },
          ]}
        />
      ) : null}
      {settingsItems.length > 0 ? (
        <PluginCapabilityGroup
          icon="Settings"
          label="Settings"
          items={settingsItems}
        />
      ) : null}
      {plugin.services.length > 0 ? (
        <PluginCapabilityGroup
          icon="Workflow"
          label="Services"
          items={plugin.services.map((service) => ({
            key: service.name,
            label: service.name,
            detail: "Background service",
            mono: true,
          }))}
        />
      ) : null}
      {plugin.schedules.length > 0 ? (
        <PluginCapabilityGroup
          icon="TimeSchedule"
          label="Schedules"
          items={plugin.schedules.map((schedule) => ({
            key: schedule.name,
            label: schedule.name,
            detail: capabilityDetail("Cron", schedule.cron),
            mono: true,
          }))}
        />
      ) : null}
    </ResourceDetailCollection>
  );
}

export function PluginActivity({
  plugin,
  runtimeStatus,
}: {
  plugin: PluginListItem;
  runtimeStatus: PluginRuntimeStatusPresentation | null;
}) {
  const showOverallState = plugin.enabled && runtimeStatus !== null;
  const hasHandlerErrors = plugin.handlerStats.errorCount > 0;
  if (
    !showOverallState &&
    !hasHandlerErrors &&
    plugin.services.length === 0 &&
    plugin.schedules.length === 0
  ) {
    return null;
  }
  return (
    <ResourceDetailCollection>
      {showOverallState && runtimeStatus !== null ? (
        <ResourceDetailListItem
          leading={
            <Icon
              name={
                runtimeStatus.tone === "error" ? "CircleX" : "AlertTriangle"
              }
              className={cn(
                "size-4",
                runtimeStatus.tone === "error"
                  ? "text-destructive"
                  : "text-warning",
              )}
              aria-hidden
            />
          }
        >
          <span className="block">{runtimeStatus.label}</span>
          {plugin.statusDetail ? (
            <span className="block text-xs text-muted-foreground">
              {plugin.statusDetail}
            </span>
          ) : null}
          <span className="mt-1 block text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Next:</span>{" "}
            {runtimeStatus.recovery}
          </span>
        </ResourceDetailListItem>
      ) : null}
      {plugin.services.map((service) => (
        <ResourceDetailListItem
          key={service.name}
          leading={<Icon name="Workflow" className="size-4" aria-hidden />}
          trailing={
            <PluginActivityState
              state={service.state}
              resourceLabel={service.name}
            />
          }
        >
          <span className="block">{service.name}</span>
          <span className="block text-xs text-muted-foreground">
            Background service
          </span>
        </ResourceDetailListItem>
      ))}
      {plugin.schedules.map((schedule) => (
        <ResourceDetailListItem
          key={schedule.name}
          leading={<Icon name="TimeSchedule" className="size-4" aria-hidden />}
          trailing={
            <PluginActivityState
              state={schedule.lastStatus}
              resourceLabel={schedule.name}
            />
          }
        >
          <span className="block">{schedule.name}</span>
          {schedule.lastError ? (
            <span className="block text-xs text-destructive">
              {schedule.lastError}
            </span>
          ) : (
            <span className="block text-xs text-muted-foreground">
              Next {formatAbsoluteDate(schedule.nextRunAt)}
            </span>
          )}
        </ResourceDetailListItem>
      ))}
      {hasHandlerErrors ? (
        <ResourceDetailListItem
          leading={
            <Icon
              name="AlertCircle"
              className="size-4 text-destructive"
              aria-hidden
            />
          }
        >
          {plugin.handlerStats.errorCount} handler{" "}
          {plugin.handlerStats.errorCount === 1 ? "error" : "errors"}
        </ResourceDetailListItem>
      ) : null}
    </ResourceDetailCollection>
  );
}
