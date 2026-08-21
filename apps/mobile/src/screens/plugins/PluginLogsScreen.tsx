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
import { useTheme } from "@/theme";
import { Button, EmptyStatePanel, Icon, Spinner, Text } from "@/ui";
import { Screen } from "../shell/Screen";

const TAIL_OPTIONS = [100, PLUGIN_LOGS_DEFAULT_TAIL, 1000] as const;

function LogLine({ line }: { line: PluginLogLine }) {
  return (
    <Pressable
      onLongPress={() => copyWithToast(line.text, "Line copied")}
      className="flex-row gap-3 px-4 py-1 active:bg-state-hover"
      accessibilityRole="text"
    >
      <Text variant="mono" tone="subtle" className="w-10 text-right text-xs">
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
 * picker, pull-free refresh (the header button), long-press to copy a line.
 */
export function PluginLogsScreen() {
  const { pluginId } = useLocalSearchParams<{ pluginId: string }>();
  const id = typeof pluginId === "string" ? pluginId : null;
  const { tokens } = useTheme();
  const insets = useSafeAreaInsets();
  const [tail, setTail] = useState<number>(PLUGIN_LOGS_DEFAULT_TAIL);
  const logs = usePluginLogs({ pluginId: id, tail });
  const lines = useMemo(() => toPluginLogLines(logs.data ?? []), [logs.data]);

  return (
    <>
      <Stack.Screen
        options={{
          title: id ? `${id} logs` : "Plugin logs",
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh logs"
              hitSlop={8}
              disabled={logs.isFetching}
              onPress={() => void logs.refetch()}
              testID="plugin-logs-refresh"
            >
              {logs.isFetching ? (
                <Spinner size="small" />
              ) : (
                <Icon name="RotateCcw" size={20} color={tokens.foreground} />
              )}
            </Pressable>
          ),
        }}
      />
      <Screen scroll={false} testID="plugin-logs-screen">
        <View className="flex-row items-center gap-2 border-b border-border px-4 py-2">
          <Text variant="caption">Tail</Text>
          {TAIL_OPTIONS.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={tail === option ? "default" : "outline"}
              onPress={() => setTail(option)}
              testID={`plugin-logs-tail-${option}`}
            >
              {String(option)}
            </Button>
          ))}
        </View>
        {logs.isPending ? (
          <View className="flex-1 items-center justify-center">
            <Spinner />
          </View>
        ) : logs.isError ? (
          <View className="gap-3 p-4">
            <Text variant="caption" tone="destructive">
              {logs.error instanceof Error
                ? logs.error.message
                : "Could not load logs"}
            </Text>
            <Button
              variant="outline"
              icon="RotateCcw"
              onPress={() => void logs.refetch()}
            >
              Retry
            </Button>
          </View>
        ) : lines.length === 0 ? (
          <View className="p-4" testID="plugin-logs-empty">
            <EmptyStatePanel>No log lines yet.</EmptyStatePanel>
          </View>
        ) : (
          <FlashList
            data={lines}
            keyExtractor={(line) => line.key}
            renderItem={({ item }) => <LogLine line={item} />}
            contentContainerStyle={{
              paddingVertical: 8,
              paddingBottom: insets.bottom + 16,
            }}
            testID="plugin-logs-list"
          />
        )}
      </Screen>
    </>
  );
}
