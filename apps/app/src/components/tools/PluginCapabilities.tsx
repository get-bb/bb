import type { ReactNode } from "react";
import type { PluginCapability } from "@bb/server-contract";
import {
  ResourceDetailCollection,
  ResourceDetailListItem,
} from "@bb/shared-ui/resource-list";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
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

function PluginActivityState({
  state,
  resourceLabel,
}: {
  state: "running" | "backoff" | "stopped" | "ok" | "error" | null;
  resourceLabel: string;
}) {
  const icon = pluginActivityIcon(state);
  return (
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

function PluginCapabilityGroup({
  icon,
  label,
  description,
  items,
}: {
  icon: IconName;
  label: string;
  description: string;
  items: readonly PluginCapabilityItem[];
}) {
  return (
    <ResourceDetailListItem
      className="h-full items-start rounded-md border border-border bg-background px-4 py-4"
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
      <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
        {description}
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

  const declared = (kind: PluginCapability["kind"]): PluginCapabilityItem[] =>
    plugin.capabilities
      .filter((capability) => capability.kind === kind)
      .map((capability) => ({
        key: `${capability.kind}:${capability.id}`,
        label: capability.label,
        detail: capability.detail ?? undefined,
        mono: kind === "skill" || kind === "agent-tool",
      }));

  const groups: Array<{
    icon: IconName;
    label: string;
    description: string;
    items: PluginCapabilityItem[];
  }> = [
    {
      icon: "AppWindow",
      label: "App surfaces",
      description: "Pages and controls you can use directly in bb.",
      items: appItems,
    },
    {
      icon: "Terminal",
      label: "Command",
      description: "A bb command people and agents can run.",
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
      label: "Settings",
      description: "Controls that change how this plugin behaves.",
      items: settingsItems,
    },
    {
      icon: "Explore",
      label: "Skills",
      description: "Reusable instructions this plugin gives your agents.",
      items: declared("skill"),
    },
    {
      icon: "Toolbox",
      label: "Agent tools",
      description: "Plugin actions agents can call while working.",
      items: declared("agent-tool"),
    },
    {
      icon: "MessageCirclePlus",
      label: "Thread integrations",
      description: "Actions and references available inside threads.",
      items: declared("thread-integration"),
    },
    {
      icon: "Palette",
      label: "Themes",
      description: "Appearance options this plugin adds to bb.",
      items: declared("theme"),
    },
  ];
  const populated = groups.filter(({ items }) => items.length > 0);

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

  // Includes is a stable part of the plugin recipe, so it explains an empty
  // result rather than disappearing.
  if (populated.length === 0) {
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
      <p className="text-sm leading-relaxed text-muted-foreground">
        What this plugin adds to bb and where you can use it.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {populated.map(({ icon, label, description, items }) => (
          <PluginCapabilityGroup
            key={label}
            icon={icon}
            label={label}
            description={description}
            items={items}
          />
        ))}
      </div>
      {live ? null : (
        <ResourceDetailListItem
          className="rounded-md border border-border bg-background px-3 py-3"
          leading={
            <Icon
              name="Info"
              className="size-4 text-muted-foreground"
              aria-hidden
            />
          }
        >
          <span className="block text-xs text-muted-foreground">
            {liveCapabilitiesNote}
          </span>
        </ResourceDetailListItem>
      )}
    </div>
  );
}

function PluginActivityGroup({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {description}
        </p>
      </div>
      <ResourceDetailCollection>{children}</ResourceDetailCollection>
    </div>
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
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Live health for background work this plugin runs. Statuses here help
        explain whether the plugin is working or needs attention.
      </p>
      {showOverallState && runtimeStatus !== null ? (
        <PluginActivityGroup
          title="Plugin health"
          description="The plugin’s overall connection and runtime state."
        >
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
        <PluginActivityGroup
          title="Background services"
          description="Long-running processes the plugin keeps active while it is enabled."
        >
          {plugin.services.map((service) => {
            const state = pluginActivityIcon(service.state);
            return (
              <ResourceDetailListItem
                key={service.name}
                leading={
                  <PluginActivityState
                    state={service.state}
                    resourceLabel={service.name}
                  />
                }
              >
                <span className="block">{service.name}</span>
                <span className={cn("block text-xs", state.className)}>
                  {state.label}
                </span>
              </ResourceDetailListItem>
            );
          })}
        </PluginActivityGroup>
      ) : null}
      {plugin.schedules.length > 0 ? (
        <PluginActivityGroup
          title="Scheduled jobs"
          description="Maintenance work the plugin runs automatically on its own schedule."
        >
          {plugin.schedules.map((schedule) => {
            const state = pluginActivityIcon(schedule.lastStatus);
            return (
              <ResourceDetailListItem
                key={schedule.name}
                leading={
                  <PluginActivityState
                    state={schedule.lastStatus}
                    resourceLabel={schedule.name}
                  />
                }
              >
                <span className="block">{schedule.name}</span>
                <span className={cn("block text-xs", state.className)}>
                  {state.label}
                </span>
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
        <PluginActivityGroup
          title="Handler errors"
          description="Failures from plugin actions or events since this plugin started."
        >
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
    </div>
  );
}
