import type { Host } from "@bb/domain";
import type {
  ProviderUsage,
  ProviderUsageResponse,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { useProfiles } from "@/app-shell";
import { selectPrimaryHost, useHosts } from "@/data/hosts";
import {
  describeUsageBody,
  formatUsageReset,
  usageBarTone,
  usageHeading,
  usageProviderConfigs,
  usageWindowValue,
  useSystemUsageLimits,
  visibleUsageProviders,
  type UsageProviderConfig,
} from "@/data/settings";
import { useSystemConfig, useSystemProviders } from "@/data/system";
import { useTheme } from "@/theme";
import {
  EmptyStatePanel,
  Icon,
  ListRow,
  Pill,
  Separator,
  Sheet,
  Spinner,
  Text,
  useSheet,
} from "@/ui";
import {
  HostStatusDot,
  PickerTrigger,
  usePickerSheetMaxHeight,
} from "../pickers";
import { Screen } from "../shell/Screen";
import { useNow } from "../shell/use-now";
import { SettingsHint, SettingsSection } from "./SettingsRows";

/**
 * `/settings/usage`: `GET /system/usage-limits?hostId=` for the primary or a
 * picked machine (a daemon RPC: offline machines cannot answer), with the
 * web section's per-provider windows and sign-in hints.
 */
export function UsageLimitsScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <Screen testID="usage-limits-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </Screen>
    );
  }
  return <ConnectedUsageLimitsScreen />;
}

function UsageWindowRow({
  window,
  now,
}: {
  window: ProviderUsageWindow;
  now: number;
}) {
  const { tokens } = useTheme();
  const tone = usageBarTone(window.usedPercent);
  const fill =
    tone === "destructive"
      ? tokens.destructive
      : tone === "warning"
        ? tokens.warning
        : tokens.primary;
  const reset = formatUsageReset(window.resetsAt, now);
  return (
    <View className="gap-1">
      <View className="flex-row items-baseline justify-between gap-2">
        <Text variant="caption" tone="foreground">
          {window.label}
        </Text>
        <Text variant="caption" className="tabular-nums">
          {usageWindowValue(window)}
        </Text>
      </View>
      <View className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <View
          className="h-full rounded-full"
          style={{
            width: `${Math.max(window.usedPercent, 2)}%`,
            backgroundColor: fill,
          }}
        />
      </View>
      {reset ? <Text variant="caption">{reset}</Text> : null}
    </View>
  );
}

function ProviderUsageBlock({
  config,
  usage,
  isLoading,
  isError,
  now,
}: {
  config: UsageProviderConfig;
  usage: ProviderUsage | undefined;
  isLoading: boolean;
  isError: boolean;
  now: number;
}) {
  const heading = usageHeading(usage);
  const body = describeUsageBody({ config, usage, isLoading, isError });
  return (
    <View className="gap-3 px-4 py-3" testID={`usage-${config.providerId}`}>
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1">
          <Text variant="heading">{config.name}</Text>
          {heading.accountEmail ? (
            <Text variant="caption" numberOfLines={1}>
              {heading.accountEmail}
            </Text>
          ) : null}
        </View>
        {heading.planLabel ? (
          <Pill variant="outline" size="sm">
            {heading.planLabel}
          </Pill>
        ) : null}
      </View>
      {body.kind === "windows" ? (
        <View className="gap-3">
          {body.windows.map((window) => (
            <UsageWindowRow key={window.label} window={window} now={now} />
          ))}
        </View>
      ) : body.kind === "message" ? (
        <Text variant="caption">{body.text}</Text>
      ) : null}
    </View>
  );
}

function ConnectedUsageLimitsScreen() {
  const { tokens } = useTheme();
  const configQuery = useSystemConfig();
  const hostsQuery = useHosts();
  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const primaryHost = selectPrimaryHost(
    hosts,
    configQuery.data?.primaryHostId ?? null,
  );
  const selectedHost =
    hosts.find((host) => host.id === selectedHostId) ?? primaryHost;
  const hostReady =
    selectedHost !== null && selectedHost.status === "connected";
  const usageQuery = useSystemUsageLimits({
    hostId: selectedHost?.id,
    enabled: configQuery.data !== undefined && hostReady,
  });
  const pickerSheet = useSheet();
  const maxHeight = usePickerSheetMaxHeight();
  const now = useNow();
  const providersQuery = useSystemProviders({
    ...(selectedHost === null ? {} : { hostId: selectedHost.id }),
    enabled: configQuery.data !== undefined && hostReady,
  });
  const usage: Partial<ProviderUsageResponse> = usageQuery.data ?? {};
  const providers = visibleUsageProviders(
    usageProviderConfigs(providersQuery.data ?? []),
    usage,
  );
  const loaded =
    hostsQuery.data !== undefined && configQuery.data !== undefined;

  return (
    <Screen testID="usage-limits-screen">
      <SettingsSection
        title="Usage limits"
        description="Your provider subscription usage, read from the machine's signed-in CLIs."
        action={
          <View className="flex-row items-center gap-2">
            {hosts.length > 1 ? (
              <PickerTrigger
                icon="Laptop"
                label={selectedHost?.name ?? "Machine"}
                variant="outline"
                onPress={pickerSheet.present}
                tone={hostReady ? "default" : "warning"}
                testID="usage-machine-picker"
                accessibilityLabel="Usage limits machine"
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reload usage data"
              hitSlop={8}
              disabled={!hostReady || usageQuery.isFetching}
              onPress={() => void usageQuery.refetch()}
              testID="usage-refresh"
            >
              {usageQuery.isFetching ? (
                <Spinner size="small" color={tokens.mutedForeground} />
              ) : (
                <Icon
                  name="RotateCcw"
                  size={18}
                  color={tokens.mutedForeground}
                />
              )}
            </Pressable>
          </View>
        }
      >
        {!loaded ? (
          <View className="items-center px-4 py-6">
            <Spinner />
          </View>
        ) : selectedHost === null ? (
          <SettingsHint
            title="No machine yet"
            message="Usage limits are read from a paired machine's provider CLIs. Pair a machine under Settings → Machines first."
            testID="usage-no-host"
          />
        ) : !hostReady ? (
          <SettingsHint
            title={`${selectedHost.name} is offline`}
            message="Usage is read live from the machine's provider CLIs. Connect it (or pick another machine) to see usage."
            testID="usage-host-offline"
          />
        ) : providers.length === 0 && !usageQuery.isLoading ? (
          <View className="px-4 py-4">
            <Text variant="caption">
              No provider CLIs are installed on {selectedHost.name}.
            </Text>
          </View>
        ) : (
          providers.map((config, index) => (
            <View key={config.providerId}>
              {index > 0 ? <Separator /> : null}
              <ProviderUsageBlock
                config={config}
                usage={usage[config.providerId]}
                isLoading={usageQuery.isLoading}
                isError={usageQuery.isError}
                now={now}
              />
            </View>
          ))
        )}
      </SettingsSection>

      <Sheet
        controller={pickerSheet}
        title="Machine"
        layout="scroll"
        maxDynamicContentSize={maxHeight}
      >
        {hosts.map((host: Host) => {
          const connected = host.status === "connected";
          const selected = host.id === selectedHost?.id;
          return (
            <ListRow
              key={host.id}
              title={host.name}
              subtitle={connected ? undefined : "Offline"}
              leading={
                <View className="w-5 items-center">
                  <HostStatusDot connected={connected} />
                </View>
              }
              trailing={
                selected ? (
                  <Icon name="Check" size={18} color={tokens.foreground} />
                ) : null
              }
              selected={selected}
              disabled={!connected}
              onPress={() => {
                pickerSheet.dismiss();
                setSelectedHostId(host.id);
              }}
              testID={`usage-machine-option-${host.id}`}
            />
          );
        })}
      </Sheet>
    </Screen>
  );
}
