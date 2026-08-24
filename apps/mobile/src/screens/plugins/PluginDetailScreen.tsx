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
  ActionSheet,
  Button,
  EmptyStatePanel,
  ListRow,
  Pill,
  Separator,
  Skeleton,
  Switch,
  Text,
  toast,
  useSheet,
} from "@/ui";
import { pluginLogsHref } from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import { PluginSettingsForm } from "./PluginSettingsForm";
import { CardNote, DetailRow, NoticeCard, SettingsSection } from "./plugin-ui";
import { PluginIcon } from "./ServerSvgIcon";

const CAPABILITY_LABELS: Record<PluginCapability["kind"], string> = {
  skill: "Skill",
  theme: "Theme",
  "agent-tool": "Agent tool",
  "thread-integration": "Thread integration",
};

function PluginHeader({ plugin }: { plugin: InstalledPlugin }) {
  return (
    <View className="flex-row items-center gap-3">
      <View className="h-12 w-12 items-center justify-center rounded-lg border border-border bg-card">
        <PluginIcon iconUrl={plugin.iconUrl} icon={plugin.icon} size={28} />
      </View>
      <View className="min-w-0 flex-1 gap-1">
        <Text variant="title" numberOfLines={2} testID="plugin-detail-name">
          {pluginDisplayName(plugin)}
        </Text>
        <View className="flex-row flex-wrap items-center gap-1.5">
          <Pill variant="outline" size="sm">{`v${plugin.version}`}</Pill>
          {plugin.publisherLabel !== null ? (
            <Pill variant="secondary" size="sm">
              {plugin.publisherLabel}
            </Pill>
          ) : null}
          <Pill
            variant={
              plugin.enabled && plugin.status === "running"
                ? "emphasis"
                : "outline"
            }
            size="sm"
          >
            {plugin.enabled ? plugin.status : "disabled"}
          </Pill>
        </View>
      </View>
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
  const { tokens } = useTheme();
  const { plugin, isPending, isError, error, refetch } = usePlugin(id);
  const updates = usePluginUpdates();
  const setEnabled = useSetPluginEnabled();
  const reload = useReloadPlugins();
  const remove = useRemovePlugin();
  const checkUpdates = useCheckPluginUpdates();
  const applyUpdate = useApplyPluginUpdate();
  const confirmRemove = useSheet();

  const updateEntry = useMemo(
    () => updates.data?.find((entry) => entry.id === id),
    [updates.data, id],
  );
  const updateSummary = summarizePluginUpdate(updateEntry);
  const name = plugin ? pluginDisplayName(plugin) : "Plugin";

  if (id === null) {
    return (
      <Screen>
        <EmptyStatePanel>No plugin selected.</EmptyStatePanel>
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: name }} />
      <Screen testID="plugin-detail-screen">
        {isPending ? (
          <View className="gap-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
          </View>
        ) : isError ? (
          <View className="gap-3">
            <Text variant="caption" tone="destructive">
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
            onOpenLogs={() => router.push(pluginLogsHref(plugin.id))}
            onRemove={confirmRemove.present}
            tokens={tokens}
          />
        )}
      </Screen>

      <ActionSheet
        controller={confirmRemove}
        title={plugin ? `${pluginRemovalLabel(plugin)} ${name}?` : undefined}
        message={plugin ? pluginRemovalDescription(plugin) : undefined}
        actions={
          plugin
            ? [
                {
                  key: "confirm-remove",
                  label: pluginRemovalLabel(plugin),
                  icon: "Trash2",
                  destructive: true,
                  onPress: () =>
                    remove.mutate(
                      { pluginId: plugin.id },
                      {
                        onSuccess: () => {
                          toast.success(`${name} removed`);
                          router.back();
                        },
                      },
                    ),
                },
              ]
            : []
        }
      />
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
  onOpenLogs,
  onRemove,
  tokens,
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
  onOpenLogs: () => void;
  onRemove: () => void;
  tokens: { subtleForeground: string };
}) {
  const health = pluginRuntimeStatusPresentation(plugin);
  const settings = pluginSettingsAvailability(plugin);
  const settingsNote = describePluginSettingsAvailability(settings);
  const lastFailure = plugin.updateState.lastFailure;
  return (
    <>
      <PluginHeader plugin={plugin} />
      {plugin.description ? (
        <Text variant="body" tone="muted" testID="plugin-detail-description">
          {plugin.description}
        </Text>
      ) : null}

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

      <SettingsSection title="State">
        <View className="flex-row items-center gap-3 px-4 py-3">
          <View className="min-w-0 flex-1 gap-0.5">
            <Text variant="label">Enabled</Text>
            <Text variant="caption">
              {plugin.enabled
                ? "The plugin's server half is loaded."
                : "bb does not load this plugin."}
            </Text>
          </View>
          <Switch
            checked={plugin.enabled}
            onCheckedChange={onToggleEnabled}
            disabled={toggling}
            testID="plugin-detail-enabled"
            accessibilityLabel="Enabled"
          />
        </View>
        <Separator />
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
          <>
            <View className="gap-0.5 px-4 py-3">
              <Text variant="label">
                {updateSummary?.title ?? "Updates not checked yet"}
              </Text>
              {updateSummary?.detail ? (
                <Text variant="caption">{updateSummary.detail}</Text>
              ) : plugin.updateState.lastCheckAt !== undefined ? (
                <Text variant="caption">
                  Last checked{" "}
                  {new Date(plugin.updateState.lastCheckAt).toLocaleString()}
                </Text>
              ) : null}
            </View>
            <Separator />
            <View className="flex-row gap-2 px-4 py-3">
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
          </>
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
          plugin.capabilities.map((capability, index) => (
            <View key={`${capability.kind}:${capability.id}`}>
              {index > 0 ? <Separator /> : null}
              <ListRow
                title={capability.label}
                subtitle={
                  capability.detail ?? CAPABILITY_LABELS[capability.kind]
                }
                leading={
                  capability.kind === "skill"
                    ? "Zap"
                    : capability.kind === "theme"
                      ? "Palette"
                      : capability.kind === "agent-tool"
                        ? "ToolCase"
                        : "MessageSquare"
                }
                trailing={
                  <Pill variant="outline" size="sm">
                    {CAPABILITY_LABELS[capability.kind]}
                  </Pill>
                }
              />
            </View>
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
        <ListRow
          title="Install path"
          subtitle={plugin.rootDir}
          leading="Folder"
          onPress={() => copyWithToast(plugin.rootDir, "Path copied")}
          titleLines={1}
        />
        {plugin.handlerStats.count > 0 ? (
          <DetailRow
            label="Handlers"
            value={`${plugin.handlerStats.count} calls · ${plugin.handlerStats.errorCount} errors · max ${Math.round(plugin.handlerStats.maxMs)} ms`}
          />
        ) : null}
      </SettingsSection>

      <SettingsSection title="Actions">
        <ListRow
          title="Reload plugin"
          subtitle="Restart its server half"
          leading="RotateCcw"
          disabled={!plugin.enabled || reloading}
          onPress={onReload}
          testID="plugin-detail-reload"
        />
        <ListRow
          title="View logs"
          subtitle="The plugin host's log tail"
          leading="FileText"
          trailing="chevron"
          onPress={onOpenLogs}
          testID="plugin-detail-logs"
        />
        <ListRow
          title={pluginRemovalLabel(plugin)}
          leading="Trash2"
          destructive
          onPress={onRemove}
          testID="plugin-detail-remove"
        />
      </SettingsSection>
      <Text variant="caption" style={{ color: tokens.subtleForeground }}>
        Plugin id {plugin.id}
      </Text>
    </>
  );
}
