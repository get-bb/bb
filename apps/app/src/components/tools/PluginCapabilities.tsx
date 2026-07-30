import { Fragment, type ReactNode } from "react";
import type { PluginCapability } from "@bb/server-contract";
import {
  ResourceDetailCollection,
  ResourceDetailListItem,
} from "@bb/shared-ui/resource-list";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
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
  activity: "service" | "schedule",
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null,
): { name: IconName; className: string; label: string } {
  if (activity === "service" && state === "running") {
    return {
      name: "CircleCheck",
      className: "text-success",
      label: "Running",
    };
  }
  if (activity === "service" && state === "backoff") {
    return {
      name: "RotateCcw",
      className: "text-warning",
      label: "Restarting",
    };
  }
  if (activity === "service" && state === "stopped") {
    return {
      name: "Pause",
      className: "text-muted-foreground",
      label: "Stopped",
    };
  }
  if (activity === "schedule" && state === null) {
    return {
      name: "Clock",
      className: "text-muted-foreground",
      label: "Scheduled",
    };
  }
  if (activity === "schedule" && state === "running") {
    return {
      name: "Loading",
      className: "animate-spin text-muted-foreground",
      label: "Running",
    };
  }
  if (activity === "schedule" && state === "ok") {
    return {
      name: "CircleCheck",
      className: "text-success",
      label: "Succeeded",
    };
  }
  if (activity === "schedule" && state === "error") {
    return { name: "CircleX", className: "text-destructive", label: "Failed" };
  }
  return activity === "service"
    ? {
        name: "Pause",
        className: "text-muted-foreground",
        label: "Stopped",
      }
    : {
        name: "Clock",
        className: "text-muted-foreground",
        label: "Scheduled",
      };
}

function PluginActivityState({
  activity,
  state,
}: {
  activity: "service" | "schedule";
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null;
}) {
  const icon = pluginActivityIcon(activity, state);
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            role="img"
            aria-label={icon.label}
            tabIndex={0}
            className="inline-flex"
          >
            <Icon
              name={icon.name}
              className={cn("size-4", icon.className)}
              aria-hidden
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>{icon.label}</TooltipContent>
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

function capabilityDetail(kind: string, id?: string): ReactNode {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      <span>{kind}</span>
      {id ? <span className="break-all font-mono">{id}</span> : null}
    </span>
  );
}

function namedSurface(
  prefix: string,
  id: string,
  title: string | undefined,
  description: string,
): PluginCapabilityItem {
  const label = title?.trim() || id;
  return {
    key: `${prefix}:${id}`,
    label,
    detail:
      label === id ? (
        description
      ) : (
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          <span>{description}</span>
          <span className="break-all font-mono text-subtle-foreground">
            {id}
          </span>
        </span>
      ),
    mono: label === id,
  };
}

function namedSlotItems(
  pluginId: string,
  slots: readonly { pluginId: string; id: string; title?: string }[],
  prefix: string,
  description: string,
): PluginCapabilityItem[] {
  return slots
    .filter((slot) => slot.pluginId === pluginId)
    .map((slot) => namedSurface(prefix, slot.id, slot.title, description));
}

function pluginAppSurfaceItems(
  pluginId: string,
  slots: PluginSlotSnapshot,
): PluginCapabilityItem[] {
  const namedSlots = [
    [slots.navPanels, "nav", "Adds a page to the app sidebar."],
    [slots.homepageSections, "homepage", "Adds content to the Home page."],
    [
      slots.threadPanelActions,
      "thread-panel",
      "Adds an action that opens a panel beside a thread.",
    ],
    [
      slots.pendingInteractions,
      "input",
      "Renders a custom interaction inside a thread.",
    ],
    [
      slots.sidebarFooterActions,
      "sidebar",
      "Adds an action to the app sidebar.",
    ],
    [
      slots.messageActions,
      "message-action",
      "Adds an action to messages in threads.",
    ],
  ] as const;
  return [
    ...namedSlots.flatMap(([items, prefix, description]) =>
      namedSlotItems(pluginId, items, prefix, description),
    ),
    ...slots.composerCustomizations
      .filter((slot) => slot.pluginId === pluginId)
      .flatMap((slot) => [
        ...(slot.actions ?? []).map((action) =>
          namedSurface(
            `composer:${slot.id}:action`,
            action.id,
            undefined,
            "Adds an action beside the thread composer.",
          ),
        ),
        ...(slot.banners ?? []).map((banner) =>
          namedSurface(
            `composer:${slot.id}:banner`,
            banner.id,
            undefined,
            "Shows information above the thread composer.",
          ),
        ),
        ...(slot.plusMenu ?? []).map((item) =>
          namedSurface(
            `composer:${slot.id}:plus-menu`,
            item.id,
            item.label,
            "Adds an item to the composer’s add menu.",
          ),
        ),
        ...(slot.richText?.effects ?? []).map((effect) =>
          namedSurface(
            `composer:${slot.id}:rich-text`,
            effect.id,
            undefined,
            "Adds rich-text behavior while composing a message.",
          ),
        ),
      ]),
    ...slots.fileOpeners
      .filter((slot) => slot.pluginId === pluginId)
      .map((slot) => ({
        ...namedSurface(
          "file",
          slot.id,
          slot.title,
          "Opens supported files in a plugin-provided viewer.",
        ),
        detail: (
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span>Opens these files in a plugin-provided viewer:</span>
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
        detail: "Renders plugin-provided content inside thread messages.",
        mono: true,
      })),
  ];
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

  const declared = (kind: PluginCapability["kind"]): PluginCapabilityItem[] =>
    plugin.capabilities
      .filter((capability) => capability.kind === kind)
      .map((capability) => ({
        key: `${capability.kind}:${capability.id}`,
        label: capability.label,
        detail: capability.detail ?? undefined,
        mono: kind === "skill" || kind === "agent-tool",
      }));

  const categories: Array<{
    icon: IconName;
    items: PluginCapabilityItem[];
  }> = [
    {
      icon: "AppWindow",
      items: appItems,
    },
    {
      icon: "Terminal",
      items: plugin.cliCommand
        ? [
            {
              key: plugin.cliCommand.name,
              label: `bb ${plugin.cliCommand.name}`,
              detail: plugin.cliCommand.summary || undefined,
              mono: true,
            },
          ]
        : [],
    },
    {
      icon: "Settings",
      items: settingsItems,
    },
    {
      icon: "Explore",
      items: declared("skill"),
    },
    {
      icon: "Toolbox",
      items: declared("agent-tool"),
    },
    {
      icon: "MessageCirclePlus",
      items: declared("thread-integration"),
    },
    {
      icon: "Palette",
      items: declared("theme"),
    },
  ];
  const items = categories.flatMap(({ icon, items: groupItems }) =>
    groupItems.map((item) => ({ ...item, icon })),
  );

  // Commands, settings, agent tools, thread integrations and app surfaces are
  // only observable on a *running* plugin — not merely an enabled one. A
  // plugin that is enabled but failed to load, or is still loading, reports
  // none of them, so keying this off `enabled` would tell the user it declares
  // nothing when the truth is that we cannot see yet.
  // "needs-configuration" is set on a *loaded* plugin, so its tools, slots and
  // settings are registered and its capabilities do render — it just cannot do
  // useful work yet. Treating it as not-running would caption a populated list
  // with "this plugin isn't running".
  const live =
    plugin.status === "running" || plugin.status === "needs-configuration";
  const liveCapabilitiesNote = plugin.enabled
    ? "This plugin isn't running, so its commands, settings, agent tools, app surfaces, and thread integrations can't be listed."
    : "Commands, settings, agent tools, app surfaces, and thread integrations are listed once this plugin is enabled.";

  // Capabilities is a stable part of the plugin recipe, so it explains an empty
  // result rather than disappearing.
  if (items.length === 0) {
    return (
      <EmptyStatePanel className="py-6">
        {live
          ? "This plugin declares no user-facing capabilities."
          : plugin.enabled
            ? "This plugin isn't running yet, so what it adds can't be listed."
            : "Enable this plugin to see what it adds to bb."}
      </EmptyStatePanel>
    );
  }

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-[fit-content(20rem)_minmax(0,1fr)]">
        {items.map((item, index) => (
          <Fragment key={item.key}>
            <dt
              className={cn(
                "flex min-w-0 items-start gap-2 py-2 pr-6",
                index > 0 && "border-t border-border/50",
              )}
            >
              <Icon
                name={item.icon}
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden
              />
              <span
                className={cn(
                  "min-w-0 break-all text-sm leading-snug text-foreground",
                  item.mono && "font-mono",
                )}
              >
                {item.label}
              </span>
            </dt>
            <dd
              className={cn(
                "min-w-0 py-2 text-xs leading-relaxed text-muted-foreground",
                index > 0 && "border-t border-border/50",
              )}
            >
              {item.detail}
            </dd>
          </Fragment>
        ))}
      </dl>
      {live ? null : (
        <p className="flex min-w-0 items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Icon name="Info" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {liveCapabilitiesNote}
        </p>
      )}
    </div>
  );
}

/**
 * A run of health rows under a quiet group header.
 *
 * The group name carries the meaning, so no boilerplate needs to sit above the
 * collection.
 */
function PluginActivityGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="bg-surface-recessed/40 px-3 py-1.5">
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          {title}
        </h3>
      </div>
      <div className="divide-y divide-border/50">{children}</div>
    </section>
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
    <div className="space-y-3">
      <ResourceDetailCollection>
        {showOverallState && runtimeStatus !== null ? (
          <PluginActivityGroup title="Plugin health">
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
          </PluginActivityGroup>
        ) : null}
        {plugin.services.length > 0 ? (
          <PluginActivityGroup title="Background services">
            {plugin.services.map((service) => {
              return (
                <ResourceDetailListItem
                  key={service.name}
                  leading={
                    <PluginActivityState
                      activity="service"
                      state={service.state}
                    />
                  }
                >
                  <span className="block">{service.name}</span>
                </ResourceDetailListItem>
              );
            })}
          </PluginActivityGroup>
        ) : null}
        {plugin.schedules.length > 0 ? (
          <PluginActivityGroup title="Scheduled jobs">
            {plugin.schedules.map((schedule) => {
              return (
                <ResourceDetailListItem
                  key={schedule.name}
                  leading={
                    <PluginActivityState
                      activity="schedule"
                      state={schedule.lastStatus}
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
              );
            })}
          </PluginActivityGroup>
        ) : null}
        {hasHandlerErrors ? (
          <PluginActivityGroup title="Handler errors">
            <ResourceDetailListItem
              leading={
                <Icon
                  name="AlertCircle"
                  className="size-4 text-destructive"
                  aria-hidden
                />
              }
            >
              <span className="block">
                {plugin.handlerStats.errorCount} failed{" "}
                {plugin.handlerStats.errorCount === 1
                  ? "handler call"
                  : "handler calls"}
              </span>
              <span className="block text-xs text-muted-foreground">
                Reload the plugin to clear this count after resolving the cause.
              </span>
            </ResourceDetailListItem>
          </PluginActivityGroup>
        ) : null}
      </ResourceDetailCollection>
    </div>
  );
}
