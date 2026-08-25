import type {
  ProviderUsage,
  ProviderUsageResponse,
  ProviderUsageWindow,
} from "@bb/host-daemon-contract";
import { Stack } from "expo-router";
import { useMemo, useState } from "react";
import { View } from "react-native";
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
import { EmptyStatePanel, Separator, Spinner, Text } from "@/ui";
import { useNow } from "../shell/use-now";
import { GroupedScreen } from "./GroupedScreen";
import { MenuValueRow } from "./MenuValueRow";
import {
  HeaderIconButton,
  SettingsHint,
  SettingsSection,
} from "./SettingsRows";

const IS_IOS = process.env.EXPO_OS === "ios";

/**
 * `/settings/usage`: `GET /system/usage-limits?hostId=` for the primary or a
 * picked machine (a daemon RPC: offline machines cannot answer), with the
 * web section's per-provider windows and sign-in hints.
 */
export function UsageLimitsScreen() {
  const { connection } = useProfiles();
  if (!connection) {
    return (
      <GroupedScreen testID="usage-limits-screen">
        <EmptyStatePanel>Add a server first.</EmptyStatePanel>
      </GroupedScreen>
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
        <Text variant="body">{window.label}</Text>
        <Text variant="body" tone="muted" numeric>
          {usageWindowValue(window)}
        </Text>
      </View>
      <View className="h-1 w-full overflow-hidden rounded-full bg-muted">
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
          <Text variant="headline">{config.name}</Text>
          {heading.accountEmail ? (
            <Text variant="caption" numberOfLines={1} selectable>
              {heading.accountEmail}
            </Text>
          ) : null}
        </View>
        {heading.planLabel ? (
          <Text variant="body" tone="muted">
            {heading.planLabel}
          </Text>
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
  const refreshDisabled = !hostReady || usageQuery.isFetching;
  const refresh = () => void usageQuery.refetch();

  return (
    <>
      {IS_IOS ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Button
            icon="arrow.clockwise"
            accessibilityLabel="Reload usage data"
            disabled={refreshDisabled}
            onPress={refresh}
          />
        </Stack.Toolbar>
      ) : null}
      <GroupedScreen testID="usage-limits-screen">
        {hosts.length > 1 ? (
          <SettingsSection title="Machine">
            <MenuValueRow
              title="Machine"
              value={selectedHost?.name ?? "Machine"}
              valueTone={hostReady ? "default" : "warning"}
              options={hosts.map((host) => ({
                value: host.id,
                label:
                  host.status === "connected"
                    ? host.name
                    : `${host.name} (offline)`,
                icon: "Laptop" as const,
                disabled: host.status !== "connected",
              }))}
              selected={selectedHost?.id ?? null}
              onSelect={setSelectedHostId}
              testID="usage-machine-picker"
              accessibilityLabel="Usage limits machine"
            />
          </SettingsSection>
        ) : null}

        <SettingsSection
          title="Usage limits"
          footnote="Your provider subscription usage, read from the machine's signed-in CLIs."
          action={
            IS_IOS ? undefined : (
              <HeaderIconButton
                icon="RotateCcw"
                accessibilityLabel="Reload usage data"
                disabled={!hostReady}
                loading={usageQuery.isFetching}
                onPress={refresh}
                testID="usage-refresh"
              />
            )
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
            <View className="px-4 py-3">
              <Text variant="footnote" tone="muted">
                No provider CLIs are installed on {selectedHost.name}.
              </Text>
            </View>
          ) : (
            providers.map((config, index) => (
              <View key={config.providerId}>
                {index > 0 ? <Separator inset /> : null}
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
      </GroupedScreen>
    </>
  );
}
