import type { InstalledPlugin } from "@bb/server-contract";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import {
  describePluginRow,
  filterPlugins,
  pluginDisplayName,
  pluginRemovalDescription,
  pluginRemovalLabel,
  pluginRowSignal,
  sortPlugins,
  useCheckPluginUpdates,
  usePluginList,
  useReloadPlugins,
  useRemovePlugin,
  useSetPluginEnabled,
} from "@/data/plugins";
import { describeError } from "@/lib/describe-error";
import { haptic } from "@/lib/haptics";
import { useTheme } from "@/theme";
import {
  ActionSheet,
  Button,
  EmptyStatePanel,
  Icon,
  Input,
  ListRow,
  Skeleton,
  Text,
  toast,
  useSheet,
} from "@/ui";
import {
  marketplacesHref,
  pluginBrowseHref,
  pluginDetailHref,
} from "../shell/hrefs";
import { Screen } from "../shell/Screen";
import { AddPluginSheet } from "./AddPluginSheet";
import { PluginSignalPill, SettingsSection } from "./plugin-ui";
import { PluginIcon } from "./ServerSvgIcon";

/**
 * Installed plugins (`/settings/plugins`; web Extensions → Plugins →
 * Installed): one row per plugin with its single signal, a filter, entry
 * points to Browse / Marketplaces, "+" to install from a source, and a
 * long-press menu (enable / disable, reload, uninstall). Tapping a row opens
 * the detail screen.
 */
export function PluginsScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const list = usePluginList();
  const setEnabled = useSetPluginEnabled();
  const reload = useReloadPlugins();
  const remove = useRemovePlugin();
  const checkUpdates = useCheckPluginUpdates();
  const addSheet = useSheet();
  const menu = useSheet();
  const confirmRemove = useSheet();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<InstalledPlugin | null>(null);

  const plugins = useMemo(
    () => sortPlugins(filterPlugins(list.data ?? [], query)),
    [list.data, query],
  );
  const total = list.data?.length ?? 0;

  const openMenu = (plugin: InstalledPlugin) => {
    setTarget(plugin);
    haptic("impact-heavy");
    menu.present();
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add plugin"
              hitSlop={8}
              onPress={addSheet.present}
              testID="plugins-add"
            >
              <Icon name="Plus" size={22} color={tokens.foreground} />
            </Pressable>
          ),
        }}
      />
      <Screen testID="plugins-screen">
        <SettingsSection title="Discover">
          <ListRow
            title="Browse catalog"
            subtitle="Plugins from BB Community and your marketplaces"
            leading="Explore"
            trailing="chevron"
            onPress={() => router.push(pluginBrowseHref())}
            testID="plugins-browse"
          />
          <ListRow
            title="Marketplaces"
            subtitle="Where bb reads plugin catalogs from"
            leading="PackageReceive"
            trailing="chevron"
            onPress={() => router.push(marketplacesHref())}
            testID="plugins-marketplaces"
          />
          <ListRow
            title="Add from source"
            subtitle="npm, git, or a path on the server"
            leading="Plus"
            trailing="chevron"
            onPress={addSheet.present}
            testID="plugins-add-row"
          />
        </SettingsSection>

        <View className="gap-1">
          <Text variant="sectionLabel" className="pb-1">
            {total > 0 ? `Installed (${total})` : "Installed"}
          </Text>
          {total > 4 ? (
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="Filter plugins"
              autoCapitalize="none"
              clearButtonMode="while-editing"
              className="mb-2"
              testID="plugins-filter"
            />
          ) : null}
          <View className="overflow-hidden rounded-lg border border-border bg-card">
            {list.isPending ? (
              <View className="gap-3 px-4 py-3">
                <Skeleton className="h-5 w-3/5" />
                <Skeleton className="h-5 w-4/5" />
                <Skeleton className="h-5 w-2/5" />
              </View>
            ) : list.isError ? (
              <View className="gap-3 px-4 py-3">
                <Text variant="caption" tone="destructive">
                  Could not load plugins: {describeError(list.error)}
                </Text>
                <Button
                  variant="outline"
                  size="sm"
                  icon="RotateCcw"
                  onPress={() => void list.refetch()}
                >
                  Retry
                </Button>
              </View>
            ) : total === 0 ? (
              <View className="gap-3 px-4 py-4" testID="plugins-empty">
                <EmptyStatePanel>
                  No plugins installed on this server.
                </EmptyStatePanel>
                <Button
                  icon="Explore"
                  onPress={() => router.push(pluginBrowseHref())}
                >
                  Browse catalog
                </Button>
              </View>
            ) : plugins.length === 0 ? (
              <View className="px-4 py-4">
                <EmptyStatePanel>No plugins match “{query}”.</EmptyStatePanel>
              </View>
            ) : (
              plugins.map((plugin) => {
                const signal = pluginRowSignal(plugin);
                return (
                  <ListRow
                    key={plugin.id}
                    title={pluginDisplayName(plugin)}
                    subtitle={describePluginRow(plugin)}
                    leading={
                      <PluginIcon
                        iconUrl={plugin.iconUrl}
                        icon={plugin.icon}
                        size={22}
                        color={
                          plugin.enabled
                            ? tokens.foreground
                            : tokens.subtleForeground
                        }
                      />
                    }
                    trailing={
                      <View className="flex-row items-center gap-2">
                        {signal ? (
                          <PluginSignalPill
                            signal={signal}
                            testID={`plugin-signal-${plugin.id}`}
                          />
                        ) : null}
                        <Icon
                          name="ChevronRight"
                          size={18}
                          color={tokens.subtleForeground}
                        />
                      </View>
                    }
                    onPress={() => router.push(pluginDetailHref(plugin.id))}
                    onLongPress={() => openMenu(plugin)}
                    testID={`plugin-row-${plugin.id}`}
                  />
                );
              })
            )}
          </View>
        </View>

        {total > 0 ? (
          <SettingsSection title="Maintenance">
            <ListRow
              title="Check for updates"
              subtitle="Ask every plugin's source for a newer release"
              leading="Download"
              disabled={checkUpdates.isPending}
              onPress={() =>
                checkUpdates.mutate(
                  {},
                  {
                    onSuccess: (results) => {
                      const available = results.filter(
                        (entry) => entry.outcome === "update-available",
                      ).length;
                      toast.success(
                        available === 0
                          ? "Every plugin is up to date"
                          : `${available} ${available === 1 ? "update" : "updates"} available`,
                      );
                    },
                  },
                )
              }
              testID="plugins-check-updates"
            />
            <ListRow
              title="Reload all plugins"
              subtitle="Restart every plugin's server half"
              leading="RotateCcw"
              disabled={reload.isPending}
              onPress={() =>
                reload.mutate(
                  {},
                  { onSuccess: () => toast.success("Plugins reloaded") },
                )
              }
              testID="plugins-reload-all"
            />
          </SettingsSection>
        ) : null}
      </Screen>

      <AddPluginSheet
        controller={addSheet}
        target={{ kind: "source" }}
        onInstalled={(plugin) => router.push(pluginDetailHref(plugin.id))}
      />

      <ActionSheet
        controller={menu}
        title={target ? pluginDisplayName(target) : undefined}
        message={target?.description ?? undefined}
        actions={
          target
            ? [
                {
                  key: "open",
                  label: "Open",
                  icon: "ChevronRight",
                  onPress: () => router.push(pluginDetailHref(target.id)),
                },
                {
                  key: target.enabled ? "disable" : "enable",
                  label: target.enabled ? "Disable" : "Enable",
                  icon: target.enabled ? "Pause" : "Play",
                  onPress: () =>
                    setEnabled.mutate({
                      pluginId: target.id,
                      enabled: !target.enabled,
                    }),
                },
                {
                  key: "reload",
                  label: "Reload",
                  icon: "RotateCcw",
                  disabled: !target.enabled,
                  onPress: () =>
                    reload.mutate(
                      { pluginId: target.id },
                      {
                        onSuccess: () =>
                          toast.success(
                            `${pluginDisplayName(target)} reloaded`,
                          ),
                      },
                    ),
                },
                {
                  key: "remove",
                  label: pluginRemovalLabel(target),
                  icon: "Trash2",
                  destructive: true,
                  onPress: () => confirmRemove.present(),
                },
              ]
            : []
        }
      />

      <ActionSheet
        controller={confirmRemove}
        title={
          target
            ? `${pluginRemovalLabel(target)} ${pluginDisplayName(target)}?`
            : undefined
        }
        message={target ? pluginRemovalDescription(target) : undefined}
        actions={
          target
            ? [
                {
                  key: "confirm-remove",
                  label: pluginRemovalLabel(target),
                  icon: "Trash2",
                  destructive: true,
                  onPress: () =>
                    remove.mutate(
                      { pluginId: target.id },
                      {
                        onSuccess: () =>
                          toast.success(`${pluginDisplayName(target)} removed`),
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
