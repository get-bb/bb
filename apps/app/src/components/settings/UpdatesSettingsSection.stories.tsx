import type { Host } from "@bb/domain";
import type { SystemAppUpdateStatus } from "@bb/server-contract";
import { UPDATE_ACTION_ICON } from "@bb/domain/update-state";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  type ProviderCliKey,
} from "@bb/host-daemon-contract";
import type { ProviderCliIssue } from "@/components/provider-cli/provider-cli-install";
import type { ProviderCliInstallFailure } from "@/components/provider-cli/provider-cli-install-store";
import type { UpdateInventoryMachine } from "@/hooks/useUpdateInventory";
import { SettingsRowList } from "@/components/ui/settings-section";
import {
  makeHost,
  makeProviderCliStatus,
} from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import {
  BbAppUpdateRows,
  BbDaemonUpdateRow,
  ChangelogPreviewCard,
  MachineUpdatesFleetSection,
  MachineUpdatesRows,
  MachineUpdatesSection,
  ProviderCliCheckRow,
  UpdateActionButton,
} from "./UpdatesSettingsSection";

export default {
  title: "settings/Updates",
};

const noop = () => {};
const NO_JOBS: ReadonlySet<string> = new Set();
const STORY_NOW = 1_800_000_000_000;

const NPM_VERSION = {
  currentVersion: "0.38.0",
  latestVersion: "0.38.0",
  currentCommit: null,
  installKind: "npm" as const,
  source: "npm" as const,
  updateAvailable: false,
  isDevelopment: false,
  upgradeCommand: "npx bb-app@latest",
};

const IN_APP_UPDATE: SystemAppUpdateStatus = {
  activity: { phase: "idle" },
  available: {
    channel: "latest",
    commit: null,
    commitCount: null,
    subjects: [],
    version: "0.39.0",
  },
  blocked: null,
  current: { commit: null, version: "0.38.0" },
  lastResult: null,
  runningThreadCount: 0,
  support: { kind: "supported", mode: "npm" },
};

const DESKTOP_UPDATE = {
  lastCheckedAt: "2026-07-19T00:00:00.000Z",
  latestVersion: "0.39.0",
  pendingVersion: "0.39.0",
  platform: "macos" as const,
  updateAvailable: true,
  updateDownloaded: true,
  downloadState: "downloaded" as const,
  version: "0.38.0",
};

function updateIssue(
  provider: ProviderCliKey,
  currentVersion: string,
  latestVersion: string,
): ProviderCliIssue {
  const base = makeProviderCliStatus(provider);
  const action = {
    kind: "update" as const,
    label: "Update" as const,
    command: `${base.executableName} update`,
  };
  return {
    provider,
    status: {
      ...base,
      currentVersion,
      latestVersion,
      installAction: action,
      needsUpdate: true,
    },
    action,
    title: `${base.displayName} update available`,
    description: `${currentVersion} -> ${latestVersion}`,
    fingerprint: `${provider}:${currentVersion}:${latestVersion}`,
  };
}

function machineOf({
  host,
  isPrimary = false,
  issues = [],
  statusError = false,
  canRetryDaemonUpdate = false,
  providers = ["codex", "claude-code", "acp-cursor"],
}: {
  host: Host;
  isPrimary?: boolean;
  issues?: ProviderCliIssue[];
  statusError?: boolean;
  canRetryDaemonUpdate?: boolean;
  providers?: readonly ProviderCliKey[];
}): UpdateInventoryMachine {
  const statusFor = (provider: ProviderCliKey) =>
    issues.find((issue) => issue.provider === provider)?.status ??
    makeProviderCliStatus(provider);
  const providerStatus: NonNullable<UpdateInventoryMachine["providerStatus"]> =
    {};
  for (const provider of providers)
    providerStatus[provider] = statusFor(provider);
  return {
    host,
    isPrimary,
    providerStatus: host.status === "connected" ? providerStatus : null,
    statusPending: false,
    statusFetching: false,
    statusError,
    issues,
    canRetryDaemonUpdate,
  };
}

function failedProviderMachine(
  hostId: string,
  providers: readonly ProviderCliKey[] = ["codex", "claude-code", "acp-cursor"],
): UpdateInventoryMachine {
  return machineOf({
    host: makeHost({ id: hostId, name: "Old Air" }),
    providers,
    issues: [
      updateIssue("codex", "0.157.0", "0.159.3"),
      updateIssue("claude-code", "2.1.282", "2.1.287"),
    ],
  });
}

function failedProviderFailures(
  machine: UpdateInventoryMachine,
): ReadonlyMap<string, ProviderCliInstallFailure> {
  return new Map(
    machine.issues.map((issue, index) => [
      `${machine.host.id}:${issue.provider}`,
      {
        issueFingerprint: issue.fingerprint,
        kind: index === 0 ? "command" : "interrupted",
        logDialogState: {
          displayName: issue.status.displayName,
          log: `$ ${issue.status.executableName} update\n`,
          message:
            index === 0
              ? "Command exited with code 1"
              : "HTTP 504: bb connect: timed out waiting for the tunnel client",
          title: `${issue.status.displayName} update log`,
        },
      },
    ]),
  );
}

function StoryMachineRows({
  machine,
  app = false,
  appUpdate = false,
  failuresByJobKey,
}: {
  machine: UpdateInventoryMachine;
  app?: boolean;
  appUpdate?: boolean;
  failuresByJobKey?: ReadonlyMap<string, ProviderCliInstallFailure>;
}) {
  const showDaemon =
    machine.canRetryDaemonUpdate || machine.host.status !== "connected";
  return (
    <>
      {app ? (
        <BbAppUpdateRows
          systemVersion={appUpdate ? undefined : NPM_VERSION}
          desktopInfo={appUpdate ? DESKTOP_UPDATE : null}
          isDesktop={appUpdate}
          onRelaunchDesktop={noop}
          onRetryDesktop={noop}
        />
      ) : null}
      {showDaemon ? (
        <BbDaemonUpdateRow
          machine={machine}
          now={STORY_NOW}
          retryUpdatePending={false}
          onRetryDaemonUpdate={noop}
          onOpenMachine={noop}
        />
      ) : null}
      {machine.statusError ? (
        <ProviderCliCheckRow
          machine={machine}
          onRecheckClis={noop}
          onOpenMachine={noop}
        />
      ) : null}
      <MachineUpdatesRows
        machine={machine}
        runningJobKey={null}
        queuedJobKeys={NO_JOBS}
        failuresByJobKey={failuresByJobKey}
        onStartInstall={noop}
        onOpenProvider={noop}
      />
    </>
  );
}

function StoryMachineSection(props: Parameters<typeof StoryMachineRows>[0]) {
  return (
    <MachineUpdatesSection
      machine={props.machine}
      isThisMachine={false}
      showServerBadge={props.machine.isPrimary}
    >
      <StoryMachineRows {...props} />
    </MachineUpdatesSection>
  );
}

function manualUpdateIssue(
  provider: ProviderCliKey,
  currentVersion: string,
  latestVersion: string,
): ProviderCliIssue {
  const status = makeProviderCliStatus(provider, {
    currentVersion,
    latestVersion,
    installAction: null,
    needsUpdate: true,
  });
  return {
    provider,
    status,
    action: null,
    title: `${status.displayName} update available`,
    description: `${currentVersion} -> ${latestVersion}`,
    fingerprint: `${provider}:${currentVersion}:${latestVersion}:manual`,
  };
}

function missingProviderIssue(provider: ProviderCliKey): ProviderCliIssue {
  const status = makeProviderCliStatus(provider, {
    executablePath: null,
    installed: false,
    installSource: "notInstalled",
    currentVersion: null,
    latestVersion: "2.1.0",
    installAction: {
      kind: "install",
      label: "Install",
      command: "npm install -g @anthropic-ai/claude-code",
    },
    needsUpdate: false,
  });
  return {
    provider,
    status,
    action: status.installAction,
    title: `${status.displayName} CLI not installed`,
    description: "Not installed",
    fingerprint: `${provider}:not-installed`,
  };
}

export function RowVariations() {
  const providerUpdate = machineOf({
    host: makeHost({ id: "state-provider-update", name: "workstation" }),
    providers: ["codex"],
    issues: [updateIssue("codex", "0.145.0", "0.146.0")],
  });
  const providerInstalling = machineOf({
    host: makeHost({ id: "state-provider-installing", name: "studio-mac" }),
    providers: ["claude-code"],
    issues: [updateIssue("claude-code", "2.0.1", "2.1.0")],
  });
  const providerFailed = failedProviderMachine("state-provider-failed", [
    "codex",
  ]);
  const providerInterrupted = failedProviderMachine(
    "state-provider-interrupted",
    ["claude-code"],
  );
  const providerManual = machineOf({
    host: makeHost({ id: "state-provider-manual", name: "homelab" }),
    providers: ["codex"],
    issues: [manualUpdateIssue("codex", "0.145.0", "0.146.0")],
  });
  const providerMissing = machineOf({
    host: makeHost({ id: "state-provider-missing", name: "workstation" }),
    providers: ["claude-code"],
    issues: [missingProviderIssue("claude-code")],
  });
  const daemonUpdating = machineOf({
    host: makeHost({
      id: "state-daemon-updating",
      name: "studio-mac",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: STORY_NOW - 30_000,
    }),
    canRetryDaemonUpdate: true,
  });
  const daemonStalled = machineOf({
    host: makeHost({
      id: "state-daemon-stalled",
      name: "ci-runner-3",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: STORY_NOW - 6 * 60_000,
    }),
    canRetryDaemonUpdate: true,
  });
  const daemonOffline = machineOf({
    host: makeHost({
      id: "state-daemon-offline",
      name: "old-laptop",
      status: "disconnected",
    }),
  });
  const providerCheckFailed = machineOf({
    host: makeHost({ id: "state-provider-check", name: "workstation" }),
    statusError: true,
  });

  return (
    <>
      <StoryCard className="max-w-5xl" labelWidth="240px">
        <h2 className="px-4 py-3 text-sm font-semibold">bb app and daemons</h2>
        <StoryRow
          label="Up to date"
          hint="Nothing to do. The settled state stays visually quiet."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={NPM_VERSION}
                desktopInfo={null}
                isDesktop={false}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Checking"
          hint="The app version check is still in progress."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={undefined}
                desktopInfo={null}
                isDesktop={false}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Update available"
          hint="A web install cannot replace itself, so its action copies the upgrade command."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  latestVersion: "0.39.0",
                  updateAvailable: true,
                }}
                desktopInfo={null}
                isDesktop={false}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="In-app update available"
          hint="bb runs under the update shim, so it can download the update and restart itself."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={NPM_VERSION}
                appUpdate={IN_APP_UPDATE}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
                onShowAppUpdateResult={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="In-app update downloading"
          hint="The launcher is installing the new version while bb keeps running."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={NPM_VERSION}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  activity: {
                    output: [],
                    phase: "preparing",
                    startedAt: "2026-09-23T00:00:00.000Z",
                    step: "Downloading bb-app 0.39.0",
                    targetVersion: "0.39.0",
                  },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
                onShowAppUpdateResult={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="In-app update failed"
          hint="The download failed, bb kept running the current version, and the row keeps the details until dismissed."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={NPM_VERSION}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  lastResult: {
                    acknowledged: false,
                    finishedAt: "2026-09-23T00:00:00.000Z",
                    from: { commit: null, version: "0.38.0" },
                    id: "update-1",
                    logTail: ["npm error code E404"],
                    message: "npm install failed",
                    outcome: "failed",
                    phase: "install",
                    to: { commit: null, version: "0.39.0" },
                  },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
                onShowAppUpdateResult={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout — manual Git updates"
          hint="Runs from a checkout without an update shim. No comparison with npm or origin/main has been made."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  installKind: "source",
                  currentCommit: "a".repeat(40),
                  latestVersion: null,
                }}
                desktopInfo={null}
                isDesktop={false}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout — revision unavailable"
          hint="A source tree with no detected Git revision shows its declared build version without claiming freshness."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  installKind: "source",
                  currentCommit: null,
                  latestVersion: null,
                }}
                desktopInfo={null}
                isDesktop={false}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Release check unavailable"
          hint="The npm lookup failed. Retry forces another lookup without upgrading the app."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{ ...NPM_VERSION, latestVersion: null }}
                desktopInfo={null}
                isDesktop={false}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
                onRetryAppCheck={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout — up to date"
          hint="The managed checkout has successfully checked origin/main and has no incoming commits."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  installKind: "source",
                  currentCommit: "a".repeat(40),
                  latestVersion: null,
                }}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  available: null,
                  blocked: null,
                  current: { commit: "a".repeat(40), version: "0.38.0" },
                  support: { kind: "supported", mode: "source" },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout — check unavailable"
          hint="The managed checkout could not fetch origin/main."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  installKind: "source",
                  currentCommit: "a".repeat(40),
                  latestVersion: null,
                }}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  available: null,
                  blocked: {
                    reason: "fetch-failed",
                    message: "Could not fetch origin/main.",
                  },
                  current: { commit: "a".repeat(40), version: "0.38.0" },
                  support: { kind: "supported", mode: "source" },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout — branch blocked"
          hint="This branch cannot use automatic updates; no incoming update is shown."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  installKind: "source",
                  currentCommit: "a".repeat(40),
                  latestVersion: null,
                }}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  available: null,
                  blocked: {
                    reason: "not-on-main",
                    message:
                      "The checkout is on feature. Only main can be updated from the app.",
                  },
                  current: { commit: "a".repeat(40), version: "0.38.0" },
                  support: { kind: "supported", mode: "source" },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout update available"
          hint="A clean pnpm start checkout on main shows commits instead of a release version and offers to fast-forward."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  currentCommit: "a".repeat(40),
                  installKind: "source",
                }}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  available: {
                    channel: "main",
                    commit: "76a1ebcaf5c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5",
                    commitCount: 54,
                    subjects: ["Restore closed right-panel tabs"],
                    version: "0.45.0",
                  },
                  current: {
                    commit: "1b973d5584e10963018f4ae7d9c001e8ec09b99b",
                    version: "0.44.0",
                  },
                  support: { kind: "supported", mode: "source" },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
                onShowAppUpdateResult={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout — checking update"
          hint="The launcher rechecks origin/main before accepting the update target. The spinner and step replace the Update button."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  installKind: "source",
                  currentCommit: "a".repeat(40),
                  latestVersion: null,
                }}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  available: {
                    channel: "main",
                    commit: "b".repeat(40),
                    commitCount: 54,
                    subjects: ["Restore closed right-panel tabs"],
                    version: "0.45.0",
                  },
                  current: { commit: "a".repeat(40), version: "0.44.0" },
                  support: { kind: "supported", mode: "source" },
                  activity: {
                    phase: "preparing",
                    startedAt: "2026-09-23T00:00:00.000Z",
                    step: "Checking origin/main",
                    output: [],
                    targetVersion: "0.45.0",
                  },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout — ready to restart"
          hint="Validation succeeded. The launcher is waiting for the server to approve the restart."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  installKind: "source",
                  currentCommit: "a".repeat(40),
                  latestVersion: null,
                }}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  available: {
                    channel: "main",
                    commit: "b".repeat(40),
                    commitCount: 54,
                    subjects: ["Restore closed right-panel tabs"],
                    version: "0.45.0",
                  },
                  current: { commit: "a".repeat(40), version: "0.44.0" },
                  support: { kind: "supported", mode: "source" },
                  activity: {
                    phase: "preparing",
                    startedAt: "2026-09-23T00:00:00.000Z",
                    step: "Ready to restart",
                    output: [],
                    targetVersion: "0.45.0",
                  },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout — restarting"
          hint="The last row before shutdown. Git fast-forward, dependency installation, and rebuilding happen while the server is offline; there are no live rows during those steps."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  installKind: "source",
                  currentCommit: "a".repeat(40),
                  latestVersion: null,
                }}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  available: {
                    channel: "main",
                    commit: "b".repeat(40),
                    commitCount: 54,
                    subjects: ["Restore closed right-panel tabs"],
                    version: "0.45.0",
                  },
                  current: { commit: "a".repeat(40), version: "0.44.0" },
                  support: { kind: "supported", mode: "source" },
                  activity: {
                    phase: "restarting",
                    startedAt: "2026-09-23T00:00:00.000Z",
                    targetVersion: "0.45.0",
                  },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Source checkout blocked"
          hint="Incoming commits stay visible, but there is no update button until the working tree is clean."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={{
                  ...NPM_VERSION,
                  currentCommit: "a".repeat(40),
                  installKind: "source",
                }}
                appUpdate={{
                  ...IN_APP_UPDATE,
                  available: {
                    channel: "main",
                    commit: "4f1c2e9a7b0d3c5e8f1a2b3c4d5e6f7a8b9c0d1e",
                    commitCount: 12,
                    subjects: ["Fix sidebar flicker"],
                    version: "0.38.0",
                  },
                  blocked: {
                    message:
                      "The working tree has uncommitted changes. Commit or stash them to update from the app.",
                    reason: "uncommitted-changes",
                  },
                  current: {
                    commit: "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
                    version: "0.38.0",
                  },
                  support: { kind: "supported", mode: "source" },
                }}
                desktopInfo={null}
                isDesktop={false}
                onApplyAppUpdate={noop}
                onRelaunchDesktop={null}
                onRetryDesktop={null}
                onShowAppUpdateResult={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Downloading"
          hint="The desktop shell is fetching the update automatically."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={undefined}
                desktopInfo={{
                  ...DESKTOP_UPDATE,
                  downloadState: "downloading",
                  pendingVersion: null,
                  updateDownloaded: false,
                }}
                isDesktop
                onRelaunchDesktop={noop}
                onRetryDesktop={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Desktop — not checked"
          hint="No check has completed yet. Check starts a lookup without claiming the installed version is current."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={undefined}
                desktopInfo={{
                  ...DESKTOP_UPDATE,
                  lastCheckedAt: null,
                  latestVersion: null,
                  pendingVersion: null,
                  updateDownloaded: false,
                  updateAvailable: false,
                  downloadState: "idle",
                }}
                isDesktop
                onRelaunchDesktop={noop}
                onRetryDesktop={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Desktop — checking release"
          hint="The check is running. The action is disabled until it completes."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={undefined}
                desktopInfo={{
                  ...DESKTOP_UPDATE,
                  lastCheckedAt: null,
                  latestVersion: null,
                  pendingVersion: null,
                  updateDownloaded: false,
                  updateAvailable: false,
                  downloadState: "idle",
                }}
                isDesktop
                isChecking
                onRelaunchDesktop={noop}
                onRetryDesktop={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Desktop — release check unavailable"
          hint="A check completed without establishing the latest release. The installed version stays visible with an explanation and Retry."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={undefined}
                desktopInfo={{
                  ...DESKTOP_UPDATE,
                  latestVersion: null,
                  pendingVersion: null,
                  updateDownloaded: false,
                  updateAvailable: false,
                  downloadState: "idle",
                }}
                isDesktop
                onRelaunchDesktop={noop}
                onRetryDesktop={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Downloaded — relaunch"
          hint="The update is ready and needs one explicit relaunch."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={undefined}
                desktopInfo={DESKTOP_UPDATE}
                isDesktop
                onRelaunchDesktop={noop}
                onRetryDesktop={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Download failed"
          hint="The red caption states the failure; the neutral Retry button is the recovery."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <BbAppUpdateRows
                systemVersion={undefined}
                desktopInfo={{
                  ...DESKTOP_UPDATE,
                  downloadState: "failed",
                  pendingVersion: null,
                  updateDownloaded: false,
                }}
                isDesktop
                onRelaunchDesktop={noop}
                onRetryDesktop={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Machine updating bb"
          hint="The enrolled daemon is applying its required update automatically."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <StoryMachineRows machine={daemonUpdating} />
          </div>
        </StoryRow>

        <StoryRow
          label="Machine offline"
          hint="bb cannot currently reach this machine."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <StoryMachineRows machine={daemonOffline} />
          </div>
        </StoryRow>

        <StoryRow
          label="Machine update stalled"
          hint="The daemon update did not finish and can be retried."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <StoryMachineRows machine={daemonStalled} />
          </div>
        </StoryRow>
      </StoryCard>
      <StoryCard className="max-w-5xl" labelWidth="240px">
        <h2 className="px-4 py-3 text-sm font-semibold">Provider CLIs</h2>

        <StoryRow
          label="Update available"
          hint="bb has an installer it can run for this provider."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <StoryMachineRows machine={providerUpdate} />
          </div>
        </StoryRow>

        <StoryRow
          label="Installing"
          hint="The provider update is currently running."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <MachineUpdatesRows
                machine={providerInstalling}
                runningJobKey="state-provider-installing:claude-code"
                queuedJobKeys={NO_JOBS}
                onStartInstall={noop}
                onOpenProvider={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Update failed"
          hint="The red warning marks the failure and opens the log; Retry is the recovery."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <SettingsRowList>
              <MachineUpdatesRows
                machine={providerFailed}
                runningJobKey={null}
                queuedJobKeys={NO_JOBS}
                failuresByJobKey={failedProviderFailures(providerFailed)}
                onStartInstall={noop}
                onOpenProvider={noop}
              />
            </SettingsRowList>
          </div>
        </StoryRow>

        <StoryRow
          label="Connection interrupted"
          hint="The machine disconnected during installation; the warning opens the captured log and Retry starts a new attempt."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <MachineUpdatesRows
              machine={providerInterrupted}
              runningJobKey={null}
              queuedJobKeys={NO_JOBS}
              failuresByJobKey={failedProviderFailures(providerInterrupted)}
              onStartInstall={noop}
              onOpenProvider={noop}
            />
          </div>
        </StoryRow>

        <StoryRow
          label="Update in terminal"
          hint="The CLI was installed outside bb, so the update must run in its own package manager."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <StoryMachineRows machine={providerManual} />
          </div>
        </StoryRow>

        <StoryRow
          label="Never installed — no row"
          hint="A CLI with no installed version has no update, so no row renders."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <StoryMachineRows machine={providerMissing} />
          </div>
        </StoryRow>

        <StoryRow
          label="Status check failed"
          hint="The machine is connected, but bb could not inspect its provider CLIs."
        >
          <div className="w-full rounded-lg border border-border bg-card px-4 py-3.5">
            <StoryMachineRows machine={providerCheckFailed} />
          </div>
        </StoryRow>
      </StoryCard>
    </>
  );
}

export function SectionVariations() {
  const current = machineOf({
    host: makeHost({ id: "section-current", name: "workstation" }),
    isPrimary: true,
  });
  const workstation = machineOf({
    host: makeHost({ id: "section-workstation", name: "workstation" }),
    isPrimary: true,
    issues: [
      updateIssue("codex", "0.145.0", "0.146.0"),
      updateIssue("acp-cursor", "0.48.0", "0.49.0"),
    ],
  });
  const studioMac = machineOf({
    host: makeHost({ id: "section-studio", name: "studio-mac" }),
    issues: [updateIssue("claude-code", "2.0.1", "2.1.0")],
  });
  const offline = machineOf({
    host: makeHost({
      id: "section-offline",
      name: "old-laptop",
      status: "disconnected",
    }),
  });
  const stalled = machineOf({
    host: makeHost({
      id: "section-stalled",
      name: "ci-runner-3",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: STORY_NOW - 6 * 60_000,
    }),
    canRetryDaemonUpdate: true,
  });
  const failed = failedProviderMachine("section-failed");
  const updateAll = (count: number) => (
    <UpdateActionButton
      label={`Update all ${count} CLI tools`}
      tooltipLabel="Update all"
      icon={UPDATE_ACTION_ICON}
      visibleLabel="Update all"
      variant="default"
      onClick={noop}
    />
  );

  return (
    <StoryCard className="max-w-6xl" labelWidth="240px">
      <StoryRow
        label="Single machine — current"
        hint="The app and installed provider CLIs have no available updates."
      >
        <div className="w-full">
          <MachineUpdatesFleetSection>
            <StoryMachineSection machine={current} app />
          </MachineUpdatesFleetSection>
        </div>
      </StoryRow>
      <StoryRow
        label="Single machine — updates available"
        hint="Bulk actions sit beside the fleet heading; updates appear in the machine section."
      >
        <div className="w-full">
          <MachineUpdatesFleetSection action={updateAll(2)}>
            <StoryMachineSection machine={workstation} app />
          </MachineUpdatesFleetSection>
        </div>
      </StoryRow>
      <StoryRow
        label="Multiple machines"
        hint="A desktop relaunch, provider updates, failed installs, and a stalled daemon share one fleet layout."
      >
        <div className="w-full">
          <MachineUpdatesFleetSection action={updateAll(5)}>
            <StoryMachineSection machine={workstation} app appUpdate />
            <StoryMachineSection machine={studioMac} />
            <StoryMachineSection
              machine={failed}
              failuresByJobKey={failedProviderFailures(failed)}
            />
            <StoryMachineSection machine={stalled} />
          </MachineUpdatesFleetSection>
        </div>
      </StoryRow>
      <StoryRow
        label="Offline machine"
        hint="An unreachable machine keeps its own section and an offline daemon row."
      >
        <div className="w-full">
          <MachineUpdatesFleetSection>
            <StoryMachineSection machine={current} app />
            <StoryMachineSection machine={offline} />
          </MachineUpdatesFleetSection>
        </div>
      </StoryRow>
      <StoryRow
        label="Changelog preview"
        hint="The optional release preview appears above the machine update sections."
      >
        <div className="w-full space-y-6">
          <ChangelogPreviewCard />
          <MachineUpdatesFleetSection action={updateAll(2)}>
            <StoryMachineSection machine={workstation} app />
          </MachineUpdatesFleetSection>
        </div>
      </StoryRow>
    </StoryCard>
  );
}
