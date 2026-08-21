import { useState, type ReactNode } from "react";
import { View } from "react-native";
import {
  e2eModeEnabled,
  useProfileClient,
  useProfiles,
  useRealtimeConnectionState,
} from "@/app-shell";
import { useSystemConfig, useSystemVersion } from "@/data/system";
import { describeError } from "@/lib/describe-error";
import type { MobileRealtimeConnectionState } from "@/lib/realtime";
import { useTheme } from "@/theme";
import { Button, Pill, Separator, Skeleton, Text, toast } from "@/ui";

const REALTIME_LABEL: Record<MobileRealtimeConnectionState, string> = {
  connecting: "connecting",
  connected: "connected",
  reconnecting: "reconnecting",
};

function Row({
  label,
  children,
  testID,
}: {
  label: string;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View className="flex-row items-start gap-3">
      <Text variant="caption" className="w-24 pt-0.5">
        {label}
      </Text>
      <View className="min-w-0 flex-1" testID={testID}>
        {typeof children === "string" ? (
          <Text variant="body" selectable>
            {children}
          </Text>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/**
 * What the app knows about the active server: the saved profile, what
 * `/system/config` and `/system/version` report, and the live socket state.
 * Doubles as the Phase 1 proof that the SDK + query + realtime layers work.
 */
export function ServerInfoCard() {
  const { activeProfile } = useProfiles();
  const { sdk } = useProfileClient();
  const { tokens } = useTheme();
  const config = useSystemConfig();
  const version = useSystemVersion();
  const realtimeState = useRealtimeConnectionState();
  const [poking, setPoking] = useState(false);

  if (!activeProfile) return null;

  const realtimeColor =
    realtimeState === "connected"
      ? tokens.success
      : realtimeState === "reconnecting"
        ? tokens.warningText
        : tokens.mutedForeground;

  const poke = async () => {
    setPoking(true);
    try {
      await sdk.system.reloadConfig();
      toast.success("Config reload requested", {
        description: "Expect a system:config-changed realtime event.",
      });
    } catch (error) {
      toast.error("Poke failed", { description: describeError(error) });
    } finally {
      setPoking(false);
    }
  };

  return (
    <View
      className="gap-3 rounded-lg border border-border bg-card p-4"
      testID="server-info-card"
    >
      <View className="flex-row items-center gap-2">
        <Text variant="heading" className="flex-1" numberOfLines={1}>
          {activeProfile.label}
        </Text>
        <Pill variant="outline" size="sm">
          {activeProfile.mode === "connect" ? "bb connect" : "Direct"}
        </Pill>
      </View>
      <Separator />
      <Row label="Server" testID="server-info-url">
        <Text variant="mono" selectable>
          {activeProfile.serverUrl}
        </Text>
      </Row>
      <Row label="Realtime" testID="server-info-realtime">
        <View className="flex-row items-center gap-2">
          <View
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: realtimeColor }}
          />
          <Text variant="body" testID="realtime-state">
            {REALTIME_LABEL[realtimeState]}
          </Text>
        </View>
      </Row>
      <Row label="Primary host" testID="server-info-host">
        {config.isPending ? (
          <Skeleton className="h-4 w-40" />
        ) : config.isError ? (
          <Text variant="body" tone="destructive">
            {describeError(config.error)}
          </Text>
        ) : (
          <Text variant="mono" selectable>
            {config.data.primaryHostId ?? "none enrolled"}
          </Text>
        )}
      </Row>
      <Row label="Version" testID="server-info-version">
        {version.isPending ? (
          <Skeleton className="h-4 w-24" />
        ) : version.isError ? (
          <Text variant="body" tone="muted">
            unavailable
          </Text>
        ) : (
          <View className="flex-row flex-wrap items-center gap-2">
            <Text variant="mono">{version.data.currentVersion}</Text>
            {version.data.updateAvailable &&
            !version.data.isDevelopment &&
            version.data.latestVersion ? (
              <Pill variant="emphasis" size="sm">
                {`update ${version.data.latestVersion}`}
              </Pill>
            ) : null}
          </View>
        )}
      </Row>
      {config.isError ? (
        <Button
          variant="outline"
          size="sm"
          icon="RotateCcw"
          onPress={() => void config.refetch()}
        >
          Retry
        </Button>
      ) : null}
      {/* Dev builds and EXPO_PUBLIC_BB_E2E=1 bundles (the CI Release build
          runs the same flows without Metro). */}
      {e2eModeEnabled ? (
        <View className="flex-row flex-wrap gap-2 pt-1">
          <Button
            variant="secondary"
            size="sm"
            icon="Zap"
            loading={poking}
            onPress={() => void poke()}
            testID="poke-system"
          >
            Poke (reload config)
          </Button>
        </View>
      ) : null}
    </View>
  );
}
