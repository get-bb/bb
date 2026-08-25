import type { InstalledPlugin, PluginCapability } from "@bb/server-contract";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { View } from "react-native";
import {
  describePluginSettingsAvailability,
  pluginDisplayName,
  pluginRemovalDescription,
  pluginRemovalLabel,
  pluginRuntimeStatusPresentation,
  pluginSettingsAvailability,
  summarizePluginUpdate,
  useApplyPluginUpdate,
  useCheckPluginUpdates,
  usePlugin,
  usePluginUpdates,
  useReloadPlugins,
  useRemovePlugin,
  useSetPluginEnabled,
} from "@/data/plugins";
import { copyWithToast } from "@/lib/clipboard";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import {
  Button,
  confirmDestructive,
  EmptyStatePanel,
  GroupedRow,
  Skeleton,
  Switch,
  Text,
  toast,
} from "@/ui";
import { GroupedScreen } from "../settings/GroupedScreen";
import { LinkRow } from "../settings/LinkRow";
import { SettingsSection } from "../settings/SettingsRows";
import { pluginLogsHref } from "../shell/hrefs";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { CardNote, DetailRow, NoticeCard } from "./plugin-ui";
import { PluginIcon } from "./ServerSvgIcon";

const CAPABILITY_LABELS: Record<PluginCapability["kind"], string> = {
  skill: "Skill",
  theme: "Theme",
  "agent-tool": "Agent tool",
  "thread-integration": "Thread integration",
};

/** The identity cell: icon, name, version · publisher, and the runtime state on the right. */
function PluginIdentityRow({ plugin }: { plugin: InstalledPlugin }) {
  const { tokens } = useTheme();
  const running = plugin.enabled && plugin.status === "running";
  return (
    <View className="flex-row items-center gap-3 px-4 py-3">
      <View
        className="h-11 w-11 items-center justify-center"
        style={{
          borderRadius: 10,
          borderCurve: "continuous",
          backgroundColor: tokens.surfaceRecessed,
        }}
      >
        <PluginIcon iconUrl={plugin.iconUrl} icon={plugin.icon} size={26} />
      </View>
      <View className="min-w-0 flex-1">
        <Text variant="headline" numberOfLines={2} testID="plugin-detail-name">
          {pluginDisplayName(plugin)}
        </Text>
        <Text variant="caption" numberOfLines={1} selectable>
          {`v${plugin.version}${plugin.publisherLabel !== null ? ` · ${plugin.publisherLabel}` : ""}`}
        </Text>
      </View>
      <Text variant="body" tone={running ? "success" : "muted"}>
        {plugin.enabled ? plugin.status : "disabled"}
      </Text>
    </View>
  );
}

/**
 * One installed plugin (`/settings/plugins/[pluginId]`; the web's
 * `/settings/plugins/:pluginId` + Extensions detail folded into one screen):
 * identity, enable switch, runtime health + recovery, the update card
 * (check / apply), the descriptor settings form, what it includes, services /
 * schedules / CLI command, source, and the reload / logs / uninstall actions.
 */
export function PluginDetailScreen() {
  const { pluginId } = useLocalSearchParams<{ pluginId: string }>();
  const id = typeof pluginId === "string" ? pluginId : null;
  const router = useRouter();
  const { plugin, isPending, isError, error, refetch } = usePlugin(id);
  const updates = usePluginUpdates();
  const setEnabled = useSetPluginEnabled();
  const reload = useReloadPlugins();
  const remove = useRemovePlugin();
  const checkUpdates = useCheckPluginUpdates();
  const applyUpdate = useApplyPluginUpdate();

  const updateEntry = useMemo(
    () => updates.data?.find((entry) => entry.id === id),
    [updates.data, id],
  );
  const updateSummary = summarizePluginUpdate(updateEntry);
  const name = plugin ? pluginDisplayName(plugin) : "Plugin";

  if (id === null) {
    return (
      <GroupedScreen>
        <EmptyStatePanel>No plugin selected.</EmptyStatePanel>
      </GroupedScreen>
    );
  }

  const confirmRemove = () => {
    if (!plugin) return;
    confirmDestructive({
      title: `${pluginRemovalLabel(plugin)} ${name}?`,
      message: pluginRemovalDescription(plugin),
      actionLabel: pluginRemovalLabel(plugin),
      onConfirm: () =>
        remove.mutate(
          { pluginId: plugin.id },
          {
            onSuccess: () => {
              toast.success(`${name} removed`);
              router.back();
            },
          },
        ),
    });
  };

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <GroupedScreen testID="plugin-detail-screen">
        {isPending ? (
          <View className="gap-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
          </View>
        ) : isError ? (
          <View className="gap-3">
            <Text variant="footnote" tone="destructive" selectable>
              Could not load the plugin:{" "}
              {error instanceof Error ? error.message : String(error)}
            </Text>
            <Button
              variant="outline"
              icon="RotateCcw"
              onPress={() => void refetch()}
            >
              Retry
            </Button>
          </View>
        ) : plugin === null ? (
          <EmptyStatePanel>This plugin is not installed.</EmptyStatePanel>
        ) : (
          <PluginDetailBody
            plugin={plugin}
            updateSummary={updateSummary}
            checkingUpdates={checkUpdates.isPending}
            applyingUpdate={applyUpdate.isPending}
            onToggleEnabled={(enabled) =>
              setEnabled.mutate(
                { pluginId: plugin.id, enabled },
                {
                  onSuccess: () => {
                    haptic("success");
                    toast.success(
                      enabled ? `${name} enabled` : `${name} disabled`,
                    );
                  },
                },
              )
            }
            toggling={setEnabled.isPending}
            onCheckUpdates={() =>
              checkUpdates.mutate(
                { pluginId: plugin.id },
                {
                  onSuccess: (results) => {
                    const entry = results.find((r) => r.id === plugin.id);
                    toast.success(
                      entry?.outcome === "update-available"
                        ? `Update available: ${entry.candidate?.display ?? ""}`.trim()
                        : "Up to date",
                    );
                  },
                },
              )
            }
            onApplyUpdate={() =>
              applyUpdate.mutate(
                { pluginId: plugin.id },
                {
                  onSuccess: (result) => {
                    haptic("success");
                    toast.success(
                      result.outcome === "updated"
                        ? `Updated to ${result.to?.display ?? "the latest release"}`
                        : result.outcome === "rolled-back"
                          ? "Update failed and was rolled back"
                          : "Already up to date",
                      { description: result.detail ?? undefined },
                    );
                  },
                },
              )
            }
            onReload={() =>
              reload.mutate(
                { pluginId: plugin.id },
                { onSuccess: () => toast.success(`${name} reloaded`) },
              )
            }
            reloading={reload.isPending}
            onRemove={confirmRemove}
          />
        )}
      </GroupedScreen>
    </>
  );
}

function PluginDetailBody({
  plugin,
  updateSummary,
  checkingUpdates,
  applyingUpdate,
  onToggleEnabled,
  toggling,
  onCheckUpdates,
  onApplyUpdate,
  onReload,
  reloading,
  onRemove,
}: {
  plugin: InstalledPlugin;
  updateSummary: ReturnType<typeof summarizePluginUpdate>;
  checkingUpdates: boolean;
  applyingUpdate: boolean;
  onToggleEnabled: (enabled: boolean) => void;
  toggling: boolean;
  onCheckUpdates: () => void;
  onApplyUpdate: () => void;
  onReload: () => void;
  reloading: boolean;
  onRemove: () => void;
}) {
  const health = pluginRuntimeStatusPresentation(plugin);
  const settings = pluginSettingsAvailability(plugin);
  const settingsNote = describePluginSettingsAvailability(settings);
  const lastFailure = plugin.updateState.lastFailure;
  return (
    <>
      <SettingsSection
        footnote={
          plugin.description ? (
            <Text
              variant="footnote"
              tone="muted"
              selectable
              testID="plugin-detail-description"
            >
              {plugin.description}
            </Text>
          ) : undefined
        }
      >
        <PluginIdentityRow plugin={plugin} />
      </SettingsSection>

      {lastFailure !== undefined ? (
        <NoticeCard
          tone="error"
          icon="RotateCcw"
          title={`Update to ${lastFailure.version} failed and was rolled back`}
          body={lastFailure.detail}
          testID="plugin-detail-update-failed"
        />
      ) : null}
      {health !== null && plugin.enabled ? (
        <NoticeCard
          tone={health.tone}
          icon={health.icon}
          title={`${health.label}: ${health.condition}`}
          body={[plugin.statusDetail, health.recovery]
            .filter((part): part is string => !!part)
            .join("\n")}
          testID="plugin-detail-health"
        />
      ) : null}

      <SettingsSection
        title="State"
        footnote={
          plugin.enabled
            ? "The plugin's server half is loaded."
            : "bb does not load this plugin."
        }
      >
        <GroupedRow
          title="Enabled"
          trailing={
            <Switch
              checked={plugin.enabled}
              onCheckedChange={onToggleEnabled}
              disabled={toggling}
              testID="plugin-detail-enabled"
              accessibilityLabel="Enabled"
            />
          }
        />
        <DetailRow
          label="Status"
          value={plugin.enabled ? plugin.status : "disabled"}
        />
        {plugin.statusDetail && health === null ? (
          <DetailRow label="Detail" value={plugin.statusDetail} />
        ) : null}
      </SettingsSection>

      <SettingsSection title="Settings" testID="plugin-detail-settings">
        {settings.kind === "available" ? (
          <PluginSettingsForm key={plugin.id} pluginId={plugin.id} />
        ) : (
          <CardNote testID={`plugin-settings-${settings.kind}`}>
            {settingsNote ?? ""}
          </CardNote>
        )}
      </SettingsSection>

      <SettingsSection title="Updates">
        {plugin.provenance === "builtin" ? (
          <CardNote testID="plugin-detail-updates-builtin">
            Bundled with bb; it updates with the app.
          </CardNote>
        ) : (
          <GroupedRow
            title={updateSummary?.title ?? "Updates not checked yet"}
            titleLines={2}
            subtitle={
              updateSummary?.detail ??
              (plugin.updateState.lastCheckAt !== undefined
                ? `Last checked ${new Date(plugin.updateState.lastCheckAt).toLocaleString()}`
                : undefined)
            }
          />
        )}
        {plugin.provenance === "builtin" ? null : (
          <View className="flex-row gap-2 px-4 py-2.5">
            <Button
              variant="outline"
              size="sm"
              icon="Download"
              onPress={onCheckUpdates}
              loading={checkingUpdates}
              testID="plugin-detail-check-updates"
            >
              Check for updates
            </Button>
            {updateSummary?.canApply ? (
              <Button
                size="sm"
                icon="ArrowUp"
                onPress={onApplyUpdate}
                loading={applyingUpdate}
                testID="plugin-detail-apply-update"
              >
                Update
              </Button>
            ) : null}
          </View>
        )}
      </SettingsSection>

      <SettingsSection title="Includes">
        {plugin.capabilities.length === 0 ? (
          <CardNote>
            {plugin.enabled
              ? "No skills, themes, agent tools, or thread integrations."
              : "Enable the plugin to see what it contributes."}
          </CardNote>
        ) : (
          plugin.capabilities.map((capability) => (
            <GroupedRow
              key={`${capability.kind}:${capability.id}`}
              title={capability.label}
              subtitle={capability.detail ?? undefined}
              value={CAPABILITY_LABELS[capability.kind]}
              leading={
                capability.kind === "skill"
                  ? "Zap"
                  : capability.kind === "theme"
                    ? "Palette"
                    : capability.kind === "agent-tool"
                      ? "ToolCase"
                      : "MessageSquare"
              }
            />
          ))
        )}
      </SettingsSection>

      {plugin.services.length > 0 ||
      plugin.schedules.length > 0 ||
      plugin.cliCommand !== null ? (
        <SettingsSection title="Runtime">
          {plugin.cliCommand ? (
            <DetailRow
              label="CLI"
              value={`bb ${plugin.cliCommand.name} — ${plugin.cliCommand.summary}`}
              mono
            />
          ) : null}
          {plugin.services.map((service) => (
            <DetailRow
              key={`service:${service.name}`}
              label="Service"
              value={`${service.name} · ${service.state}`}
              mono
            />
          ))}
          {plugin.schedules.map((schedule) => (
            <DetailRow
              key={`schedule:${schedule.name}`}
              label="Schedule"
              value={`${schedule.name} · ${schedule.cron} · next ${new Date(schedule.nextRunAt).toLocaleString()}${schedule.lastStatus ? ` · last ${schedule.lastStatus}` : ""}`}
              mono
            />
          ))}
        </SettingsSection>
      ) : null}

      <SettingsSection title="Source">
        <DetailRow label="Source" value={plugin.sourceDisplay} mono />
        <DetailRow label="Provenance" value={plugin.provenance} />
        <GroupedRow
          title="Install path"
          subtitle={plugin.rootDir}
          leading="Folder"
          onPress={() => copyWithToast(plugin.rootDir, "Path copied")}
          accessibilityHint="Copies the path"
        />
        {plugin.handlerStats.count > 0 ? (
          <DetailRow
            label="Handlers"
            value={`${plugin.handlerStats.count} calls · ${plugin.handlerStats.errorCount} errors · max ${Math.round(plugin.handlerStats.maxMs)} ms`}
          />
        ) : null}
      </SettingsSection>

      <SettingsSection title="Actions" footnote={`Plugin id ${plugin.id}`}>
        <GroupedRow
          title="Reload plugin"
          subtitle="Restart its server half"
          leading="RotateCcw"
          disabled={!plugin.enabled || reloading}
          onPress={onReload}
          testID="plugin-detail-reload"
        />
        <LinkRow
          href={pluginLogsHref(plugin.id)}
          title="View logs"
          subtitle="The plugin host's log tail"
          leading="FileText"
          testID="plugin-detail-logs"
        />
        <GroupedRow
          title={pluginRemovalLabel(plugin)}
          leading="Trash2"
          destructive
          onPress={onRemove}
          testID="plugin-detail-remove"
        />
      </SettingsSection>
    </>
  );
}
