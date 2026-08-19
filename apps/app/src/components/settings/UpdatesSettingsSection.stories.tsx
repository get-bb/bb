import type { ReactNode } from "react";
import type { Host } from "@bb/domain";
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
  BbAppUpdateRows,
  BbDaemonUpdateRow,
  ChangelogPreviewCard,
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
    commandKind: "exec" as const,
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
            claudeCode: statusFor("claudeCode"),
            cursor: statusFor("cursor"),
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

/** The default-off changelog preview experiment in its enabled state. */
export function ChangelogPreviewExperiment() {
  return (
    <SettingsStoryChrome activeSection="updates">
      <ChangelogPreviewCard />
    </SettingsStoryChrome>
  );
}

function StoryMachineSection({
  machine,
  app = false,
  appUpdate = false,
  action,
}: {
  machine: UpdateInventoryMachine;
  app?: boolean;
  appUpdate?: boolean;
  action?: ReactNode;
}) {
  const showDaemon =
    machine.canRetryDaemonUpdate || machine.host.status !== "connected";
  return (
    <MachineUpdatesSection machine={machine} action={action}>
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

/** Multiple machines, each owning its app, daemon, or provider update rows. */
export function MultiMachine() {
  const workstation = machineOf({
    host: makeHost({ id: "host-primary", name: "workstation" }),
    isPrimary: true,
    issues: [
      updateIssue("codex", "0.145.0", "0.146.0"),
      updateIssue("cursor", "0.48.0", "0.49.0"),
    ],
  });
  const studioMac = machineOf({
    host: makeHost({ id: "host-studio", name: "studio-mac" }),
    issues: [updateIssue("claudeCode", "2.0.1", "2.1.0")],
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
      <StoryMachineSection
        machine={workstation}
        app
        appUpdate
        action={
          <div role="toolbar" aria-label="Bulk update actions">
            <UpdateActionButton
              label="Update all 3 CLI tools"
              tooltipLabel="Update all"
              icon={UPDATE_ACTION_ICON}
              variant="default"
              onClick={noop}
            />
          </div>
        }
      />
      <StoryMachineSection machine={studioMac} />
      <StoryMachineSection machine={ciRunner} />
    </StoryPage>
  );
}

/** The same hierarchy without a redundant all-machines wrapper. */
export function SingleMachine() {
  const workstation = machineOf({
    host: makeHost({ id: "host-primary", name: "workstation" }),
    isPrimary: true,
    issues: [updateIssue("claudeCode", "2.0.1", "2.1.0")],
  });
  return (
    <StoryPage>
      <StoryMachineSection machine={workstation} app />
    </StoryPage>
  );
}

/** A settled machine keeps the existing explicit bb app confirmation. */
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
