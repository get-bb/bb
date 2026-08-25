import type { InstalledPlugin } from "@bb/server-contract";
import { Stack, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
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
  confirmDestructive,
  DisclosureChevron,
  EmptyStatePanel,
  GroupedRow,
  Input,
  Skeleton,
  Text,
  toast,
  useSheet,
  type ActionSheetAction,
} from "@/ui";
import { GroupedScreen } from "../settings/GroupedScreen";
import { LinkRow } from "../settings/LinkRow";
import { useBadgeColors } from "../settings/settings-badges";
import { HeaderIconButton, SettingsSection } from "../settings/SettingsRows";
import {
  marketplacesHref,
  pluginBrowseHref,
  pluginDetailHref,
} from "../shell/hrefs";
import { AddPluginSheet } from "./AddPluginSheet";
import { PluginSignalPill } from "./plugin-ui";
import { PluginIcon } from "./ServerSvgIcon";

const IS_IOS = process.env.EXPO_OS === "ios";

/**
 * Installed plugins (`/settings/plugins`; web Extensions → Plugins →
 * Installed): one row per plugin with its single signal, a header search
 * bar, entry points to Browse / Marketplaces, "+" to install from a source,
 * and a long-press action sheet (enable / disable, reload, uninstall) on
 * both platforms. Tapping a row opens the detail screen; Check for updates
 * / Reload all sit in the iOS overflow menu (a Maintenance group on
 * Android).
 */
export function PluginsScreen() {
  const router = useRouter();
  const { tokens } = useTheme();
  const colors = useBadgeColors();
  const list = usePluginList();
  const setEnabled = useSetPluginEnabled();
  const reload = useReloadPlugins();
  const remove = useRemovePlugin();
  const checkUpdates = useCheckPluginUpdates();
  const addSheet = useSheet();
  const menu = useSheet();
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<InstalledPlugin | null>(null);

  const plugins = useMemo(
    () => sortPlugins(filterPlugins(list.data ?? [], query)),
    [list.data, query],
  );
  const total = list.data?.length ?? 0;

  const checkForUpdates = () =>
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
    );
  const reloadAll = () =>
    reload.mutate({}, { onSuccess: () => toast.success("Plugins reloaded") });

  const confirmRemove = (plugin: InstalledPlugin) =>
    confirmDestructive({
      title: `${pluginRemovalLabel(plugin)} ${pluginDisplayName(plugin)}?`,
      message: pluginRemovalDescription(plugin),
      actionLabel: pluginRemovalLabel(plugin),
      onConfirm: () =>
        remove.mutate(
          { pluginId: plugin.id },
          {
            onSuccess: () =>
              toast.success(`${pluginDisplayName(plugin)} removed`),
          },
        ),
    });

  const actionsFor = (plugin: InstalledPlugin): ActionSheetAction[] => [
    {
      key: "open",
      label: "Open",
      icon: "ChevronRight",
      onPress: () => router.push(pluginDetailHref(plugin.id)),
    },
    {
      key: plugin.enabled ? "disable" : "enable",
      label: plugin.enabled ? "Disable" : "Enable",
      icon: plugin.enabled ? "Pause" : "Play",
      onPress: () =>
        setEnabled.mutate({ pluginId: plugin.id, enabled: !plugin.enabled }),
    },
    {
      key: "reload",
      label: "Reload",
      icon: "RotateCcw",
      disabled: !plugin.enabled,
      onPress: () =>
        reload.mutate(
          { pluginId: plugin.id },
          {
            onSuccess: () =>
              toast.success(`${pluginDisplayName(plugin)} reloaded`),
          },
        ),
    },
    {
      key: "remove",
      label: pluginRemovalLabel(plugin),
      icon: "Trash2",
      destructive: true,
      onPress: () => confirmRemove(plugin),
    },
  ];

  return (
    <>
      {IS_IOS ? (
        <>
          <Stack.SearchBar
            placeholder="Filter plugins"
            autoCapitalize="none"
            hideWhenScrolling={false}
            onChangeText={(event) => setQuery(event.nativeEvent.text)}
            onCancelButtonPress={() => setQuery("")}
          />
          <Stack.Toolbar placement="right">
            <Stack.Toolbar.Button
              icon="plus"
              accessibilityLabel="Add plugin"
              onPress={addSheet.present}
            />
            <Stack.Toolbar.Menu
              icon="ellipsis.circle"
              accessibilityLabel="Plugin maintenance"
            >
              <Stack.Toolbar.MenuAction
                icon="arrow.down.circle"
                disabled={total === 0 || checkUpdates.isPending}
                onPress={checkForUpdates}
              >
                Check for updates
              </Stack.Toolbar.MenuAction>
              <Stack.Toolbar.MenuAction
                icon="arrow.clockwise"
                disabled={total === 0 || reload.isPending}
                onPress={reloadAll}
              >
                Reload all
              </Stack.Toolbar.MenuAction>
            </Stack.Toolbar.Menu>
          </Stack.Toolbar>
        </>
      ) : (
        <Stack.Screen
          options={{
            headerRight: () => (
              <HeaderIconButton
                icon="Plus"
                accessibilityLabel="Add plugin"
                onPress={addSheet.present}
                testID="plugins-add"
              />
            ),
          }}
        />
      )}
      <GroupedScreen testID="plugins-screen">
        <SettingsSection title="Discover">
          <LinkRow
            href={pluginBrowseHref()}
            title="Browse catalog"
            badge={{ icon: "Explore", symbol: "book.fill", color: colors.blue }}
            testID="plugins-browse"
          />
          <LinkRow
            href={marketplacesHref()}
            title="Marketplaces"
            badge={{
              icon: "PackageReceive",
              symbol: "shippingbox.fill",
              color: colors.teal,
            }}
            testID="plugins-marketplaces"
          />
          <GroupedRow
            title="Add from source"
            subtitle="npm, git, or a path on the server"
            badge={{ icon: "Plus", symbol: "plus", color: colors.green }}
            trailing="chevron"
            onPress={addSheet.present}
            testID="plugins-add-row"
          />
        </SettingsSection>

        {IS_IOS ? null : (
          <Input
            value={query}
            onChangeText={setQuery}
            placeholder="Filter plugins"
            autoCapitalize="none"
            clearButtonMode="while-editing"
            testID="plugins-filter"
          />
        )}

        <SettingsSection
          title={total > 0 ? `Installed (${total})` : "Installed"}
          footnote={
            total > 0
              ? `Tap a plugin for its settings and logs${IS_IOS ? "." : "; long-press to enable, reload or uninstall it."}`
              : undefined
          }
        >
          {list.isPending ? (
            <View className="gap-3 px-4 py-3">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-5 w-4/5" />
              <Skeleton className="h-5 w-2/5" />
            </View>
          ) : list.isError ? (
            <View className="gap-3 px-4 py-3">
              <Text variant="footnote" tone="destructive" selectable>
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
                <LinkRow
                  key={plugin.id}
                  href={pluginDetailHref(plugin.id)}
                  title={pluginDisplayName(plugin)}
                  subtitle={describePluginRow(plugin)}
                  leading={
                    <PluginIcon
                      iconUrl={plugin.iconUrl}
                      icon={plugin.icon}
                      size={20}
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
                      <DisclosureChevron />
                    </View>
                  }
                  onLongPress={() => {
                    setTarget(plugin);
                    haptic("impact-heavy");
                    menu.present();
                  }}
                  testID={`plugin-row-${plugin.id}`}
                />
              );
            })
          )}
        </SettingsSection>

        {total > 0 && !IS_IOS ? (
          <SettingsSection title="Maintenance">
            <GroupedRow
              title="Check for updates"
              subtitle="Ask every plugin's source for a newer release"
              leading="Download"
              disabled={checkUpdates.isPending}
              onPress={checkForUpdates}
              testID="plugins-check-updates"
            />
            <GroupedRow
              title="Reload all plugins"
              subtitle="Restart every plugin's server half"
              leading="RotateCcw"
              disabled={reload.isPending}
              onPress={reloadAll}
              testID="plugins-reload-all"
            />
          </SettingsSection>
        ) : null}
      </GroupedScreen>

      <AddPluginSheet
        controller={addSheet}
        target={{ kind: "source" }}
        onInstalled={(plugin) => router.push(pluginDetailHref(plugin.id))}
      />

      <ActionSheet
        controller={menu}
        title={target ? pluginDisplayName(target) : undefined}
        message={target?.description ?? undefined}
        actions={target ? actionsFor(target) : []}
      />
    </>
  );
}
