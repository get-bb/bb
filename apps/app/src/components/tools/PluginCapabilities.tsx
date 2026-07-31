import type { ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@bb/shared-ui/button";
import type { PluginCapability } from "@bb/server-contract";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import {
  PluginDetailGlyph,
  PluginDetailRow,
  PluginDetailTable,
} from "@/components/tools/plugin-detail-table";
import { formatAbsoluteDate } from "@/components/plugin/management/plugin-ui";
import type { PluginRuntimeStatusPresentation } from "@/components/plugin/management/plugin-status";
import { appToast } from "@/components/ui/app-toast";
import { invalidatePluginList } from "@/hooks/cache-owners/plugin-cache-owner";
import {
  reloadPlugin,
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
    // The app says "working" by shimmering a row's own icon, never by swapping
    // it for a spinner (ThreadRow.tsx:144). A running job keeps its clock.
    return {
      name: "Clock",
      className: "animate-shine-icon text-muted-foreground",
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
    <PluginDetailGlyph
      icon={icon.name}
      label={icon.label}
      className={icon.className}
    />
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

  // `kind` is the name behind the glyph, not a column. Most plugins contribute
  // one or two items per kind, so a Kind column is near-unique per row and
  // reads as filler; the glyph carries it and names itself on hover or focus.
  const categories: Array<{
    icon: IconName;
    kind: string;
    items: PluginCapabilityItem[];
  }> = [
    {
      icon: "AppWindow",
      kind: "App surface",
      items: appItems,
    },
    {
      icon: "Terminal",
      kind: "Command",
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
      kind: "Setting",
      items: settingsItems,
    },
    {
      icon: "Explore",
      kind: "Skill",
      items: declared("skill"),
    },
    {
      icon: "Toolbox",
      kind: "Agent tool",
      items: declared("agent-tool"),
    },
    {
      icon: "MessageCirclePlus",
      kind: "Thread integration",
      items: declared("thread-integration"),
    },
    {
      icon: "Palette",
      kind: "Theme",
      items: declared("theme"),
    },
  ];
  const items = categories.flatMap(({ icon, kind, items: groupItems }) =>
    groupItems.map((item) => ({ ...item, icon, kind })),
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
      <PluginDetailTable>
        {items.map((item) => (
          <PluginDetailRow
            key={item.key}
            glyph={
              <PluginDetailGlyph
                icon={item.icon}
                label={item.kind}
                className="text-muted-foreground"
              />
            }
            name={item.label}
            mono={item.mono}
            detail={item.detail}
          />
        ))}
      </PluginDetailTable>
      {live ? null : (
        <p className="flex min-w-0 items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Icon name="Info" className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {liveCapabilitiesNote}
        </p>
      )}
    </div>
  );
}

function PluginRuntimeStatusAlert({
  plugin,
  runtimeStatus,
  onReload,
  reloadPending,
}: {
  plugin: PluginListItem;
  runtimeStatus: PluginRuntimeStatusPresentation;
  onReload: () => void;
  reloadPending: boolean;
}) {
  const canReload =
    plugin.status === "error" || plugin.status === "degraded";
  const destructive = runtimeStatus.tone === "error";
  return (
    <div
      role="alert"
      className={cn(
        // Matched to the other banners in the stack: same radius, same padding,
        // same gap. They read as one column of alerts, not three recipes.
        "flex min-w-0 items-start gap-3 rounded-md border px-3.5 py-3",
        destructive
          ? "border-destructive/30 bg-destructive/5"
          : "border-warning/30 bg-warning/5",
      )}
    >
      <Icon
        name={runtimeStatus.icon}
        className={cn(
          "mt-0.5 size-4 shrink-0",
          destructive ? "text-destructive" : "text-warning",
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        {/*
          The title is plain foreground like every other banner: the icon and
          the border already carry the tone, and colouring the label too made
          this one alert shout past the others in the same stack.
        */}
        <p className="text-sm font-medium text-foreground">
          {runtimeStatus.label}
        </p>
        {plugin.statusDetail ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {plugin.statusDetail}
          </p>
        ) : null}
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
          {runtimeStatus.recovery}
        </p>
      </div>
      {canReload ? (
        <Button
          type="button"
          size="sm"
          disabled={reloadPending}
          className="h-7 shrink-0 px-2.5 text-xs"
          onClick={onReload}
        >
          {reloadPending ? (
            <Icon name="Loading" className="size-3.5 animate-spin" aria-hidden />
          ) : null}
          {reloadPending ? "Reloading…" : "Reload"}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Whether the plugin has anything to say about its own health beyond the two
 * tables — a bad overall runtime state, or failed handler calls.
 */
export function pluginHasHealthAlerts(
  plugin: PluginListItem,
  runtimeStatus: PluginRuntimeStatusPresentation | null,
): boolean {
  return (
    (plugin.enabled && runtimeStatus !== null) ||
    plugin.handlerStats.errorCount > 0
  );
}

/**
 * The plugin's health problems, for the page's banner stack.
 *
 * These are not services or scheduled jobs, so they have no row in either
 * table; and they are the things a user may need to act on, so they belong with
 * the other banners under the header rather than below the content they
 * explain.
 */
export function PluginHealthAlerts({
  plugin,
  runtimeStatus,
}: {
  plugin: PluginListItem;
  runtimeStatus: PluginRuntimeStatusPresentation | null;
}) {
  const queryClient = useQueryClient();
  const reload = useMutation({
    mutationFn: () => reloadPlugin(fetch, plugin.id),
    onSuccess: () => invalidatePluginList({ queryClient }),
    onError: (error) => {
      appToast.error("Failed to reload plugin", {
        description: error instanceof Error ? error.message : String(error),
      });
    },
  });
  const showOverallState = plugin.enabled && runtimeStatus !== null;
  const errorCount = plugin.handlerStats.errorCount;
  if (!showOverallState && errorCount === 0) return null;
  return (
    <>
      {showOverallState && runtimeStatus !== null ? (
        <PluginRuntimeStatusAlert
          plugin={plugin}
          runtimeStatus={runtimeStatus}
          reloadPending={reload.isPending}
          onReload={() => reload.mutate()}
        />
      ) : null}
      {errorCount > 0 ? (
        <div className="flex min-w-0 items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3.5 py-3">
          <Icon
            name="AlertCircle"
            className="mt-0.5 size-4 shrink-0 text-destructive"
            aria-hidden
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground">
              {errorCount} failed{" "}
              {errorCount === 1 ? "handler call" : "handler calls"}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              Reload the plugin to clear this count after resolving the cause.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Long-running processes the plugin keeps alive. */
export function PluginServices({ plugin }: { plugin: PluginListItem }) {
  return (
    <PluginDetailTable>
      {plugin.services.map((service) => (
        <PluginDetailRow
          key={service.name}
          glyph={
            <PluginActivityState activity="service" state={service.state} />
          }
          name={service.name}
          detail={null}
        />
      ))}
    </PluginDetailTable>
  );
}

/** Work the plugin has asked bb to run on a timer. */
export function PluginSchedules({ plugin }: { plugin: PluginListItem }) {
  return (
    <PluginDetailTable>
      {plugin.schedules.map((schedule) => (
        <PluginDetailRow
          key={schedule.name}
          glyph={
            <PluginActivityState
              activity="schedule"
              state={schedule.lastStatus}
            />
          }
          name={schedule.name}
          detail={
            schedule.lastError ? (
              <span className="text-destructive">{schedule.lastError}</span>
            ) : (
              `Next ${formatAbsoluteDate(schedule.nextRunAt)}`
            )
          }
        />
      ))}
    </PluginDetailTable>
  );
}
