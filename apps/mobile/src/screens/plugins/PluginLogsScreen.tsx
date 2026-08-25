import { FlashList } from "@shopify/flash-list";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  PLUGIN_LOGS_DEFAULT_TAIL,
  toPluginLogLines,
  usePluginLogs,
  type PluginLogLine,
} from "@/data/plugins";
import { copyWithToast } from "@/lib/clipboard";
import { Button, EmptyStatePanel, Spinner, Text } from "@/ui";
import { SegmentedChoice } from "../settings/SegmentedChoice";
import { HeaderIconButton } from "../settings/SettingsRows";
import { Screen } from "../shell/Screen";

const IS_IOS = process.env.EXPO_OS === "ios";

const TAIL_OPTIONS = [100, PLUGIN_LOGS_DEFAULT_TAIL, 1000].map((tail) => ({
  value: String(tail),
  label: String(tail),
}));

function LogLine({ line }: { line: PluginLogLine }) {
  return (
    <Pressable
      onLongPress={() => copyWithToast(line.text, "Line copied")}
      className={`flex-row gap-3 px-4 py-1 ${IS_IOS ? "active:bg-state-active" : "active:bg-state-hover"}`}
      accessibilityRole="text"
    >
      <Text
        variant="mono"
        tone="subtle"
        numeric
        className="w-10 text-right text-xs"
      >
        {line.index + 1}
      </Text>
      <Text variant="mono" className="min-w-0 flex-1 text-xs" selectable>
        {line.text}
      </Text>
    </Pressable>
  );
}

/**
 * A plugin's log tail (`/settings/plugins/[pluginId]/logs`, `GET
 * /plugins/:id/logs?tail=`): numbered mono lines, newest last, a tail-size
 * segmented control at the top of the list, refresh from the header, and
 * long-press to copy a line. The list is the route's first scrollable, so
 * it owns the header inset.
 */
export function PluginLogsScreen() {
  const { pluginId } = useLocalSearchParams<{ pluginId: string }>();
  const id = typeof pluginId === "string" ? pluginId : null;
  const insets = useSafeAreaInsets();
  const [tail, setTail] = useState<number>(PLUGIN_LOGS_DEFAULT_TAIL);
  const logs = usePluginLogs({ pluginId: id, tail });
  const lines = useMemo(() => toPluginLogLines(logs.data ?? []), [logs.data]);
  const refresh = () => void logs.refetch();

  const header = (
    <View className="px-4 py-2">
      <SegmentedChoice
        options={TAIL_OPTIONS}
        value={String(tail)}
        onChange={(value) => setTail(Number(value))}
        testID="plugin-logs-tail"
        testIDPrefix="plugin-logs-tail"
      />
    </View>
  );
  const empty = logs.isPending ? (
    <View className="items-center justify-center py-16">
      <Spinner />
    </View>
  ) : logs.isError ? (
    <View className="gap-3 p-4">
      <Text variant="footnote" tone="destructive" selectable>
        {logs.error instanceof Error
          ? logs.error.message
          : "Could not load logs"}
      </Text>
      <Button variant="outline" icon="RotateCcw" onPress={refresh}>
        Retry
      </Button>
    </View>
  ) : (
    <View className="p-4" testID="plugin-logs-empty">
      <EmptyStatePanel>No log lines yet.</EmptyStatePanel>
    </View>
  );

  return (
    <>
      <Stack.Screen
        options={{
          title: id ? `${id} logs` : "Plugin logs",
          ...(IS_IOS
            ? {}
            : {
                headerRight: () => (
                  <HeaderIconButton
                    icon="RotateCcw"
                    accessibilityLabel="Refresh logs"
                    loading={logs.isFetching}
                    onPress={refresh}
                    testID="plugin-logs-refresh"
                  />
                ),
              }),
        }}
      />
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="arrow.clockwise"
            accessibilityLabel="Refresh logs"
            disabled={logs.isFetching}
            onPress={refresh}
          />
        </Stack.Toolbar>
      ) : null}
      <Screen scroll={false} testID="plugin-logs-screen">
        <FlashList
          data={lines}
          keyExtractor={(line) => line.key}
          renderItem={({ item }) => <LogLine line={item} />}
          ListHeaderComponent={header}
          ListEmptyComponent={empty}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{
            paddingVertical: 8,
            paddingBottom: insets.bottom + 16,
          }}
          testID="plugin-logs-list"
        />
      </Screen>
    </>
  );
}
