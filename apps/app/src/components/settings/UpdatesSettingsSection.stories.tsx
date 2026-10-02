import type { ReactNode } from "react";
import type { Host } from "@bb/domain";
import type { SystemAppUpdateStatus } from "@bb/server-contract";
import { UPDATE_ACTION_ICON } from "@bb/domain/update-state";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  type ProviderCliKey,
} from "@bb/host-daemon-contract";
import type { ProviderCliIssue } from "@/components/provider-cli/provider-cli-install";
import type { UpdateInventoryMachine } from "@/hooks/useUpdateInventory";
import { SettingsStoryChrome } from "../../../.ladle/story-settings-chrome";
import {
  makeHost,
  makeProviderCliStatus,
} from "../../../.ladle/story-fixtures";
import {
  StoryState as State,
  StoryStateGroup as Group,
  StoryStates as Story,
} from "../../../.ladle/story-states";
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
}: {
  host: Host;
  isPrimary?: boolean;
  issues?: ProviderCliIssue[];
  statusError?: boolean;
  canRetryDaemonUpdate?: boolean;
}): UpdateInventoryMachine {
  const statusFor = (provider: ProviderCliKey) =>
    issues.find((issue) => issue.provider === provider)?.status ??
    makeProviderCliStatus(provider);
  return {
    host,
    isPrimary,
    providerStatus:
      host.status === "connected"
        ? {
            codex: statusFor("codex"),
            "claude-code": statusFor("claude-code"),
            "acp-cursor": statusFor("acp-cursor"),
          }
        : null,
    statusPending: false,
    statusFetching: false,
    statusError,
    issues,
    canRetryDaemonUpdate,
  };
}

function StoryPage({ children }: { children: ReactNode }) {
  return (
    <SettingsStoryChrome activeSection="updates">
      <div className="space-y-6">{children}</div>
    </SettingsStoryChrome>
  );
}

export function ChangelogPreviewExperiment() {
  window.localStorage.removeItem(
    "bb.settings.updates.dismissed-changelog-version",
  );
  const workstation = machineOf({
    host: makeHost({ id: "changelog-workstation", name: "workstation" }),
    isPrimary: true,
    issues: [updateIssue("codex", "0.145.0", "0.146.0")],
  });
  return (
    <StoryPage>
      <ChangelogPreviewCard />
      <MachineUpdatesFleetSection>
        <StoryMachineSection machine={workstation} app />
      </MachineUpdatesFleetSection>
    </StoryPage>
  );
}

function StoryMachineSection({
  machine,
  app = false,
  appUpdate = false,
}: {
  machine: UpdateInventoryMachine;
  app?: boolean;
  appUpdate?: boolean;
}) {
  const showDaemon =
    machine.canRetryDaemonUpdate || machine.host.status !== "connected";
  return (
    <MachineUpdatesSection
      machine={machine}
      isThisMachine={false}
      showServerBadge={false}
    >
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
        onStartInstall={noop}
        onOpenProvider={noop}
      />
    </MachineUpdatesSection>
  );
}

function Why({ items }: { items: readonly string[] }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => (
        <li key={item} className="flex gap-1.5">
          <span aria-hidden className="text-subtle-foreground">
            •
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

function StoryAppState({ children }: { children: ReactNode }) {
  const machine = machineOf({
    host: makeHost({ id: "state-app", name: "workstation" }),
    isPrimary: true,
  });
  return (
    <MachineUpdatesSection
      machine={machine}
      isThisMachine={false}
      showServerBadge={false}
    >
      {children}
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

export function UpdateStates() {
  const providerUpdate = machineOf({
    host: makeHost({ id: "state-provider-update", name: "workstation" }),
    issues: [updateIssue("codex", "0.145.0", "0.146.0")],
  });
  const providerInstalling = machineOf({
    host: makeHost({ id: "state-provider-installing", name: "studio-mac" }),
    issues: [updateIssue("claude-code", "2.0.1", "2.1.0")],
  });
  const providerManual = machineOf({
    host: makeHost({ id: "state-provider-manual", name: "homelab" }),
    issues: [manualUpdateIssue("codex", "0.145.0", "0.146.0")],
  });
  const providerMissing = machineOf({
    host: makeHost({ id: "state-provider-missing", name: "workstation" }),
    issues: [
      updateIssue("codex", "0.145.0", "0.146.0"),
      missingProviderIssue("claude-code"),
    ],
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
    <SettingsStoryChrome activeSection="updates" contentOwnsPageShell>
      <Story
        title="Updates — every state"
        description="Each state Settings → Updates can reach, once, rendered by the production component."
        renderedLabel="Rendered card"
        renderedNote="The real Updates section"
      >
        <Group
          title="bb"
          note="The app itself, and the machine daemons it runs."
        />

        <State
          name="Up to date"
          note="Nothing to do. The settled state stays visually quiet."
        >
          <StoryAppState>
            <BbAppUpdateRows
              systemVersion={NPM_VERSION}
              desktopInfo={null}
              isDesktop={false}
              onRelaunchDesktop={null}
              onRetryDesktop={null}
            />
          </StoryAppState>
        </State>

        <State
          name="Checking"
          note="The app version check is still in progress."
        >
          <StoryAppState>
            <BbAppUpdateRows
              systemVersion={undefined}
              desktopInfo={null}
              isDesktop={false}
              onRelaunchDesktop={null}
              onRetryDesktop={null}
            />
          </StoryAppState>
        </State>

        <State
          name="Update available"
          note="A web install cannot replace itself, so its action copies the upgrade command."
        >
          <StoryAppState>
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
          </StoryAppState>
        </State>

        <State
          name="In-app update available"
          note="bb runs under the update shim, so it can download the update and restart itself."
        >
          <StoryAppState>
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
          </StoryAppState>
        </State>

        <State
          name="In-app update downloading"
          note="The launcher is installing the new version while bb keeps running."
        >
          <StoryAppState>
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
          </StoryAppState>
        </State>

        <State
          name="In-app update failed"
          note="The download failed, bb kept running the current version, and the row keeps the details until dismissed."
        >
          <StoryAppState>
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
          </StoryAppState>
        </State>

        <State
          name="Source checkout blocked"
          note="A pnpm start checkout explains why it cannot fast-forward instead of offering a button."
        >
          <StoryAppState>
            <BbAppUpdateRows
              systemVersion={NPM_VERSION}
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
          </StoryAppState>
        </State>

        <State
          name="Downloading"
          note="The desktop shell is fetching the update automatically."
        >
          <StoryAppState>
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
          </StoryAppState>
        </State>

        <State
          name="Downloaded — relaunch"
          note="The update is ready and needs one explicit relaunch."
        >
          <StoryAppState>
            <BbAppUpdateRows
              systemVersion={undefined}
              desktopInfo={DESKTOP_UPDATE}
              isDesktop
              onRelaunchDesktop={noop}
              onRetryDesktop={noop}
            />
          </StoryAppState>
        </State>

        <State
          name="Download failed"
          note="The red caption states the failure; the neutral Retry button is the recovery."
        >
          <StoryAppState>
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
          </StoryAppState>
        </State>

        <State
          name="Machine updating bb"
          note="The enrolled daemon is applying its required update automatically."
        >
          <StoryMachineSection machine={daemonUpdating} />
        </State>

        <State
          name="Machine offline"
          note="bb cannot currently reach this machine."
        >
          <StoryMachineSection machine={daemonOffline} />
        </State>

        <State
          name="Machine update stalled"
          note="The daemon update did not finish and can be retried."
        >
          <StoryMachineSection machine={daemonStalled} />
        </State>

        <Group
          title="Provider CLIs"
          note="Agent CLIs installed on each machine."
        />

        <State
          name="Update available"
          note="bb has an installer it can run for this provider."
        >
          <StoryMachineSection machine={providerUpdate} />
        </State>

        <State
          name="Installing"
          note="The provider update is currently running."
        >
          <MachineUpdatesSection
            machine={providerInstalling}
            isThisMachine={false}
            showServerBadge={false}
          >
            <MachineUpdatesRows
              machine={providerInstalling}
              runningJobKey="state-provider-installing:claude-code"
              queuedJobKeys={NO_JOBS}
              onStartInstall={noop}
              onOpenProvider={noop}
            />
          </MachineUpdatesSection>
        </State>

        <State
          name="Update in terminal"
          note="The CLI was installed outside bb, so the update must run in its own package manager."
        >
          <StoryMachineSection machine={providerManual} />
        </State>

        <State
          name="Never installed — no row"
          note={
            <Why
              items={[
                "A CLI with no installed version has no update, so it stays off this page.",
                "Claude Code is absent in this fixture; only the stale Codex row renders.",
              ]}
            />
          }
        >
          <StoryMachineSection machine={providerMissing} />
        </State>

        <State
          name="Status check failed"
          note="The machine is connected, but bb could not inspect its provider CLIs."
        >
          <StoryMachineSection machine={providerCheckFailed} />
        </State>
      </Story>
    </SettingsStoryChrome>
  );
}

export function MultiMachine() {
  const workstation = machineOf({
    host: makeHost({ id: "host-primary", name: "workstation" }),
    isPrimary: true,
    issues: [
      updateIssue("codex", "0.145.0", "0.146.0"),
      updateIssue("acp-cursor", "0.48.0", "0.49.0"),
    ],
  });
  const studioMac = machineOf({
    host: makeHost({ id: "host-studio", name: "studio-mac" }),
    issues: [updateIssue("claude-code", "2.0.1", "2.1.0")],
  });
  const ciRunner = machineOf({
    host: makeHost({
      id: "host-ci",
      name: "ci-runner-3",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: STORY_NOW - 6 * 60_000,
    }),
    canRetryDaemonUpdate: true,
  });

  return (
    <StoryPage>
      <MachineUpdatesFleetSection
        action={
          <div role="toolbar" aria-label="Bulk update actions">
            <UpdateActionButton
              label="Update all 3 CLI tools"
              tooltipLabel="Update all"
              icon={UPDATE_ACTION_ICON}
              visibleLabel="Update all"
              variant="default"
              onClick={noop}
            />
          </div>
        }
      >
        <StoryMachineSection machine={workstation} app appUpdate />
        <StoryMachineSection machine={studioMac} />
        <StoryMachineSection machine={ciRunner} />
      </MachineUpdatesFleetSection>
    </StoryPage>
  );
}

export function SingleMachine() {
  const workstation = machineOf({
    host: makeHost({ id: "host-primary", name: "workstation" }),
    isPrimary: true,
    issues: [updateIssue("claude-code", "2.0.1", "2.1.0")],
  });
  return (
    <StoryPage>
      <StoryMachineSection machine={workstation} app />
    </StoryPage>
  );
}

export function NoUpdatesAvailable() {
  const workstation = machineOf({
    host: makeHost({ id: "host-primary", name: "workstation" }),
    isPrimary: true,
  });
  return (
    <StoryPage>
      <StoryMachineSection machine={workstation} app />
    </StoryPage>
  );
}
