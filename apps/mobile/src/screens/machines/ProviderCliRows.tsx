import type { Host } from "@bb/domain";
import type {
  ProviderCliKey,
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract/local";
import { useEffect } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  hasProviderCliAction,
  providerCliRowState,
  useProviderCliInstallRunner,
  type ProviderCliInstallRecord,
  type ProviderCliIssue,
  type ProviderCliRowTone,
} from "@/data/hosts";
import { useTheme } from "@/theme";
import {
  Button,
  Separator,
  Sheet,
  Spinner,
  Text,
  useSheet,
  type SheetController,
} from "@/ui";

/**
 * One machine's provider CLI rows (web `MachineUpdatesRows` body): name +
 * version → latest, the state label, and the Install / Update / Retry /
 * View log actions backed by the app-wide install runner.
 */

export interface ProviderCliRowsProps {
  host: Host;
  status: ProviderCliStatusResponse | null;
  statusPending: boolean;
  statusError: boolean;
  issues: readonly ProviderCliIssue[];
  runner: ReturnType<typeof useProviderCliInstallRunner>;
  testIDPrefix?: string;
}

function toneColor(
  tone: ProviderCliRowTone | "subtle",
  tokens: ReturnType<typeof useTheme>["tokens"],
): string {
  switch (tone) {
    case "attention":
      return tokens.warningText;
    case "destructive":
      return tokens.destructiveText;
    default:
      return tokens.subtleForeground;
  }
}

function ProviderCliRow({
  host,
  provider,
  status,
  issue,
  runner,
  testID,
}: {
  host: Host;
  provider: ProviderCliKey;
  status: ProviderCliStatus;
  issue: ProviderCliIssue | null;
  runner: ProviderCliRowsProps["runner"];
  testID?: string;
}) {
  const { tokens } = useTheme();
  const state = providerCliRowState({ issue, installed: status.installed });
  const record = runner.recordFor(host.id, provider);
  const running = record?.status === "running";
  const queued = record?.status === "queued";
  // A stored failure only counts while the problem it was started for is
  // still the current one; a later status change retires it.
  const failure =
    record?.status === "failed" &&
    issue !== null &&
    record.issueFingerprint === issue.fingerprint
      ? record
      : null;
  const succeeded =
    record?.status === "succeeded" && issue === null ? record : null;
  const logRecord = failure ?? succeeded;
  const actionable =
    issue !== null && hasProviderCliAction(issue) && !running && !queued;
  const latest = issue !== null ? status.latestVersion : null;
  const label = failure
    ? "Failed"
    : running
      ? "Running…"
      : queued
        ? "Queued"
        : (state?.label ?? null);
  const labelTone: ProviderCliRowTone | "subtle" = failure
    ? "destructive"
    : running
      ? "attention"
      : (state?.tone ?? "subtle");

  return (
    <View className="gap-2 px-4 py-3" testID={testID}>
      <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1.5">
        <View className="min-w-0 flex-1 flex-row items-baseline gap-2">
          <Text variant="label" numberOfLines={1} className="shrink">
            {status.displayName}
          </Text>
          {status.currentVersion ? (
            <Text variant="mono" tone="readback" className="text-xs">
              {status.currentVersion}
              {latest !== null && latest !== status.currentVersion
                ? ` → ${latest}`
                : ""}
            </Text>
          ) : null}
        </View>
        <View className="flex-row items-center gap-2">
          {running ? <Spinner size="small" color={tokens.warningText} /> : null}
          {label ? (
            <Text
              variant="caption"
              style={{ color: toneColor(labelTone, tokens) }}
            >
              {label}
            </Text>
          ) : null}
          {logRecord ? (
            <Button
              size="sm"
              variant="outline"
              onPress={() => runner.openLog(logRecord.jobKey)}
              testID={testID ? `${testID}-log` : undefined}
            >
              View log
            </Button>
          ) : null}
          {actionable ? (
            <Button
              size="sm"
              variant={failure ? "outline" : "default"}
              onPress={() => runner.startInstall({ hostId: host.id, issue })}
              testID={testID ? `${testID}-action` : undefined}
            >
              {failure ? "Retry" : issue.action.label}
            </Button>
          ) : null}
        </View>
      </View>
      {failure?.message ? (
        <Text variant="caption" tone="destructive">
          {failure.message}
        </Text>
      ) : issue !== null && !hasProviderCliAction(issue) ? (
        <Text variant="caption">{issue.description}</Text>
      ) : null}
    </View>
  );
}

export function ProviderCliRows({
  host,
  status,
  statusPending,
  statusError,
  issues,
  runner,
  testIDPrefix,
}: ProviderCliRowsProps) {
  if (host.status !== "connected") {
    return (
      <View className="px-4 py-3">
        <Text variant="caption">Offline — connect to check provider CLIs.</Text>
      </View>
    );
  }
  if (statusError) {
    return (
      <View className="px-4 py-3">
        <Text variant="caption" tone="destructive">
          Couldn't check provider CLIs on {host.name}.
        </Text>
      </View>
    );
  }
  if (statusPending || status === null) {
    return (
      <View className="flex-row items-center gap-2 px-4 py-3">
        <Spinner size="small" />
        <Text variant="caption">Checking provider CLIs…</Text>
      </View>
    );
  }
  const issuesByProvider = new Map(
    issues.map((issue) => [issue.provider, issue]),
  );
  const rows = Object.keys(status);
  return (
    <>
      {rows.map((provider, index) => {
        const entry = status[provider];
        if (entry === undefined) return null;
        return (
          <View key={provider}>
            {index > 0 ? <Separator /> : null}
            <ProviderCliRow
              host={host}
              provider={provider}
              status={entry}
              issue={issuesByProvider.get(provider) ?? null}
              runner={runner}
              testID={testIDPrefix ? `${testIDPrefix}-${provider}` : undefined}
            />
          </View>
        );
      })}
    </>
  );
}

export interface ProviderCliInstallLogSheetProps {
  controller: SheetController;
  record: ProviderCliInstallRecord | null;
}

/** The install/update output of one run, full screen-ish, monospace. */
export function ProviderCliInstallLogSheet({
  controller,
  record,
}: ProviderCliInstallLogSheetProps) {
  const verb = record?.actionKind === "update" ? "update" : "install";
  const insets = useSafeAreaInsets();
  return (
    <Sheet
      controller={controller}
      title={record ? `${record.displayName} ${verb} log` : "Install log"}
      snapPoints={["85%"]}
      layout="custom"
    >
      {/* `custom` layout: the body owns the home-indicator inset. */}
      <View
        className="flex-1 gap-2 px-4 pt-2"
        style={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}
      >
        {record?.message ? (
          <Text
            variant="caption"
            tone={record.status === "failed" ? "destructive" : "muted"}
          >
            {record.message}
          </Text>
        ) : null}
        <ScrollView
          className="flex-1 rounded-md border border-border bg-muted/40"
          contentContainerStyle={{ padding: 12 }}
        >
          <ScrollView horizontal>
            <Text variant="mono" className="text-xs" selectable>
              {record?.log && record.log.length > 0
                ? record.log
                : "No output yet."}
            </Text>
          </ScrollView>
        </ScrollView>
      </View>
    </Sheet>
  );
}

/**
 * Mount once per screen that shows provider CLI rows: presents the log sheet
 * on every "View log" request (a row's button or the finish toast's action).
 * The sheet keeps showing the last requested record after it is dismissed,
 * so re-opening needs no state write.
 */
export function ProviderCliInstallLogHost({
  runner,
}: {
  runner: ProviderCliRowsProps["runner"];
}) {
  const sheet = useSheet();
  const request = runner.logRequest;
  const seq = request?.seq ?? 0;
  useEffect(() => {
    if (seq === 0) return;
    sheet.present();
  }, [seq, sheet]);
  return (
    <ProviderCliInstallLogSheet
      controller={sheet}
      record={request?.record ?? null}
    />
  );
}
