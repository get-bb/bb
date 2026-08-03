import type { ReactNode } from "react";
import type { Host } from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import type { ProviderCliIssue } from "@/components/provider-cli/provider-cli-install";
import type { UpdateInventoryMachine } from "@/hooks/useUpdateInventory";
import {
  BbAppUpdateRows,
  MachineUpdatesRows,
  UpdatesRowList,
  UpdatesSection,
} from "./UpdatesSettingsSection";

export default {
  title: "settings/Updates",
};

const noop = () => {};
const NO_JOBS: ReadonlySet<string> = new Set();

function Stage({ children }: { children: ReactNode }) {
  return <div className="w-full max-w-2xl space-y-6 p-4">{children}</div>;
}

function makeHost(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    type: "persistent",
    status: "connected",
    lastSeenAt: 1_700_000_000_000,
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  };
}

interface ProviderStatusOverrides {
  installed?: boolean;
  currentVersion?: string | null;
  latestVersion?: string | null;
  needsUpdate?: boolean;
  versionUnsupported?: boolean;
  withAction?: boolean;
}

function providerStatus(
  provider: "codex" | "claudeCode",
  overrides: ProviderStatusOverrides = {},
) {
  const displayName = provider === "codex" ? "Codex" : "Claude Code";
  const executableName = provider === "codex" ? "codex" : "claude";
  const installed = overrides.installed ?? true;
  const needsUpdate = overrides.needsUpdate ?? false;
  const withAction = overrides.withAction ?? (needsUpdate || !installed);
  return {
    displayName,
    executableName,
    executablePath: installed ? `/usr/local/bin/${executableName}` : null,
    installed,
    installSource: installed
      ? ("npmGlobal" as const)
      : ("notInstalled" as const),
    currentVersion:
      overrides.currentVersion !== undefined
        ? overrides.currentVersion
        : installed
          ? "1.0.0"
          : null,
    latestVersion:
      overrides.latestVersion !== undefined ? overrides.latestVersion : "1.0.1",
    minimumSupportedVersion: null,
    npmPackageName: null,
    npmGlobalPackageVersion: null,
    installAction: withAction
      ? {
          kind: installed ? ("update" as const) : ("install" as const),
          label: installed ? ("Update" as const) : ("Install" as const),
          commandKind: "exec" as const,
          command: installed
            ? `${executableName} update`
            : `npm install -g ${executableName}`,
        }
      : null,
    needsUpdate,
    versionUnsupported: overrides.versionUnsupported ?? false,
  };
}

function issueFor(
  provider: "codex" | "claudeCode",
  overrides: ProviderStatusOverrides = {},
): ProviderCliIssue {
  const status = providerStatus(provider, overrides);
  return {
    provider,
    status,
    action: status.installAction,
    title: `${status.displayName} update available`,
    description: "story",
    fingerprint: `${provider}:story`,
  };
}

function machineOf(args: {
  host: Host;
  statuses?: {
    codex: ReturnType<typeof providerStatus>;
    claudeCode: ReturnType<typeof providerStatus>;
  };
  issues?: ProviderCliIssue[];
  statusPending?: boolean;
  statusError?: boolean;
  canRetryDaemonUpdate?: boolean;
}): UpdateInventoryMachine {
  return {
    host: args.host,
    isPrimary: args.host.id === "host-primary",
    providerStatus:
      args.statuses === undefined
        ? null
        : {
            ...args.statuses,
            cursor: {
              ...providerStatus("codex", { installed: false }),
              displayName: "Cursor",
              executableName: "agent",
              latestVersion: null,
              installAction: null,
            },
          },
    statusPending: args.statusPending ?? false,
    statusError: args.statusError ?? false,
    issues: args.issues ?? [],
    canRetryDaemonUpdate: args.canRetryDaemonUpdate ?? false,
  };
}

function MachineSection({ machine }: { machine: UpdateInventoryMachine }) {
  return (
    <UpdatesSection title="Machines">
      <UpdatesRowList>
        <MachineUpdatesRows
          machine={machine}
          runningJobKey={null}
          queuedJobKeys={NO_JOBS}
          retryUpdatePending={false}
          onStartInstall={noop}
          onRetryDaemonUpdate={noop}
        />
      </UpdatesRowList>
    </UpdatesSection>
  );
}

function StoryActionButton({ children }: { children: ReactNode }) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-6 px-2 text-xs"
    >
      {children}
    </Button>
  );
}

export function HealthyFleet() {
  const statuses = {
    codex: providerStatus("codex", {
      currentVersion: "0.146.0",
      latestVersion: "0.146.0",
    }),
    claudeCode: providerStatus("claudeCode", {
      currentVersion: "2.1.0",
      latestVersion: "2.1.0",
    }),
  };
  return (
    <Stage>
      <UpdatesSection
        title="bb"
        footnote="Connected machines follow the server version automatically."
        action={
          <>
            <span className="text-xs text-subtle-foreground">
              Checked 2m ago
            </span>
            <StoryActionButton>What's new</StoryActionButton>
          </>
        }
      >
        <UpdatesRowList>
          <BbAppUpdateRows
            systemVersion={{
              currentVersion: "0.0.33",
              latestVersion: "0.0.33",
              source: "npm",
              updateAvailable: false,
              isDevelopment: false,
              upgradeCommand: "npx bb-app@latest",
            }}
            desktopInfo={null}
            isDesktop={false}
            onRelaunchDesktop={null}
            onRetryDesktop={null}
          />
        </UpdatesRowList>
      </UpdatesSection>
      <UpdatesSection
        title="Machines"
        action={
          <span className="text-xs text-subtle-foreground">
            2 machines, all in sync
          </span>
        }
      >
        <UpdatesRowList>
          <MachineUpdatesRows
            machine={machineOf({
              host: makeHost({ id: "host-primary", name: "workstation" }),
              statuses,
            })}
            runningJobKey={null}
            queuedJobKeys={NO_JOBS}
            retryUpdatePending={false}
            onStartInstall={noop}
            onRetryDaemonUpdate={noop}
          />
          <MachineUpdatesRows
            machine={machineOf({
              host: makeHost({ id: "host-remote", name: "studio-mac" }),
              statuses,
            })}
            runningJobKey={null}
            queuedJobKeys={NO_JOBS}
            retryUpdatePending={false}
            onStartInstall={noop}
            onRetryDaemonUpdate={noop}
          />
        </UpdatesRowList>
      </UpdatesSection>
    </Stage>
  );
}

export function MixedFleet() {
  const codex = providerStatus("codex", {
    currentVersion: "0.145.0",
    latestVersion: "0.146.0",
    needsUpdate: true,
  });
  const claude = providerStatus("claudeCode", {
    currentVersion: "2.1.0",
    latestVersion: "2.1.0",
  });
  return (
    <Stage>
      <UpdatesSection
        title="bb"
        footnote="Connected machines follow the server version automatically."
        action={
          <>
            <span className="text-xs text-subtle-foreground">
              Checked just now
            </span>
            <StoryActionButton>What's new</StoryActionButton>
          </>
        }
      >
        <UpdatesRowList>
          <BbAppUpdateRows
            systemVersion={{
              currentVersion: "0.0.32",
              latestVersion: "0.0.33",
              source: "npm",
              updateAvailable: true,
              isDevelopment: false,
              upgradeCommand: "npx bb-app@latest",
            }}
            desktopInfo={null}
            isDesktop={false}
            onRelaunchDesktop={null}
            onRetryDesktop={null}
          />
        </UpdatesRowList>
      </UpdatesSection>
      <UpdatesSection
        title="Machines"
        action={
          <>
            <span className="text-xs text-subtle-foreground">
              1 machine can't connect
            </span>
            <StoryActionButton>Update all (1)</StoryActionButton>
          </>
        }
      >
        <UpdatesRowList>
          <MachineUpdatesRows
            machine={machineOf({
              host: makeHost({ id: "host-primary", name: "workstation" }),
              statuses: { codex, claudeCode: claude },
              issues: [
                issueFor("codex", {
                  currentVersion: "0.145.0",
                  latestVersion: "0.146.0",
                  needsUpdate: true,
                }),
              ],
            })}
            runningJobKey={null}
            queuedJobKeys={NO_JOBS}
            retryUpdatePending={false}
            onStartInstall={noop}
            onRetryDaemonUpdate={noop}
          />
          <MachineUpdatesRows
            machine={machineOf({
              host: makeHost({
                id: "host-remote",
                name: "homelab",
                status: "disconnected",
                lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
              }),
              canRetryDaemonUpdate: true,
            })}
            runningJobKey={null}
            queuedJobKeys={NO_JOBS}
            retryUpdatePending={false}
            onStartInstall={noop}
            onRetryDaemonUpdate={noop}
          />
        </UpdatesRowList>
      </UpdatesSection>
    </Stage>
  );
}

export function WebAppUpdateAvailable() {
  return (
    <Stage>
      <UpdatesSection title="bb">
        <UpdatesRowList>
          <BbAppUpdateRows
            systemVersion={{
              currentVersion: "0.0.32",
              latestVersion: "0.0.33",
              source: "npm",
              updateAvailable: true,
              isDevelopment: false,
              upgradeCommand: "npx bb-app@latest",
            }}
            desktopInfo={null}
            isDesktop={false}
            onRelaunchDesktop={null}
            onRetryDesktop={null}
          />
        </UpdatesRowList>
      </UpdatesSection>
    </Stage>
  );
}

export function DesktopUpdateReady() {
  return (
    <Stage>
      <UpdatesSection title="bb">
        <UpdatesRowList>
          <BbAppUpdateRows
            systemVersion={undefined}
            desktopInfo={{
              downloadState: "downloaded",
              lastCheckedAt: "2026-07-19T00:00:00.000Z",
              latestVersion: "0.0.33",
              pendingVersion: "0.0.33",
              platform: "macos",
              updateAvailable: true,
              updateDownloaded: true,
              version: "0.0.32",
            }}
            isDesktop
            onRelaunchDesktop={noop}
            onRetryDesktop={noop}
          />
        </UpdatesRowList>
      </UpdatesSection>
    </Stage>
  );
}

export function DesktopDownloading() {
  return (
    <Stage>
      <UpdatesSection title="bb">
        <UpdatesRowList>
          <BbAppUpdateRows
            systemVersion={undefined}
            desktopInfo={{
              downloadState: "downloading",
              lastCheckedAt: "2026-07-19T00:00:00.000Z",
              latestVersion: "0.0.33",
              pendingVersion: null,
              platform: "macos",
              updateAvailable: true,
              updateDownloaded: false,
              version: "0.0.32",
            }}
            isDesktop
            onRelaunchDesktop={noop}
            onRetryDesktop={noop}
          />
        </UpdatesRowList>
      </UpdatesSection>
    </Stage>
  );
}

export function MachineWithUpdateAndInstall() {
  const codex = providerStatus("codex", {
    currentVersion: "0.140.0",
    latestVersion: "0.141.0",
    needsUpdate: true,
  });
  const claude = providerStatus("claudeCode", { installed: false });
  return (
    <Stage>
      <MachineSection
        machine={machineOf({
          host: makeHost({ id: "host-primary", name: "workstation" }),
          statuses: { codex, claudeCode: claude },
          issues: [
            issueFor("codex", {
              currentVersion: "0.140.0",
              latestVersion: "0.141.0",
              needsUpdate: true,
            }),
            issueFor("claudeCode", { installed: false }),
          ],
        })}
      />
    </Stage>
  );
}

export function MachineRunningAndQueued() {
  const codex = providerStatus("codex", {
    currentVersion: "0.140.0",
    latestVersion: "0.141.0",
    needsUpdate: true,
  });
  const claude = providerStatus("claudeCode", {
    currentVersion: "2.0.9",
    latestVersion: "2.1.0",
    needsUpdate: true,
  });
  const machine = machineOf({
    host: makeHost({ id: "host-primary", name: "workstation" }),
    statuses: { codex, claudeCode: claude },
    issues: [
      issueFor("codex", { needsUpdate: true }),
      issueFor("claudeCode", { needsUpdate: true }),
    ],
  });
  return (
    <Stage>
      <UpdatesSection title="Machines">
        <UpdatesRowList>
          <MachineUpdatesRows
            machine={machine}
            runningJobKey="host-primary:codex"
            queuedJobKeys={new Set(["host-primary:claudeCode"])}
            retryUpdatePending={false}
            onStartInstall={noop}
            onRetryDaemonUpdate={noop}
          />
        </UpdatesRowList>
      </UpdatesSection>
    </Stage>
  );
}

export function MachineOffline() {
  return (
    <Stage>
      <MachineSection
        machine={machineOf({
          host: makeHost({
            id: "host-remote",
            name: "homelab",
            status: "disconnected",
          }),
        })}
      />
    </Stage>
  );
}

export function MachineDaemonNeedsUpdate() {
  return (
    <Stage>
      <MachineSection
        machine={machineOf({
          host: makeHost({
            id: "host-remote",
            name: "homelab",
            status: "disconnected",
            lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
          }),
          canRetryDaemonUpdate: true,
        })}
      />
    </Stage>
  );
}

export function MachineStatusFailed() {
  return (
    <Stage>
      <MachineSection
        machine={machineOf({
          host: makeHost({ id: "host-remote", name: "homelab" }),
          statusError: true,
        })}
      />
    </Stage>
  );
}

export function MachineChecking() {
  return (
    <Stage>
      <MachineSection
        machine={machineOf({
          host: makeHost({ id: "host-remote", name: "homelab" }),
          statusPending: true,
        })}
      />
    </Stage>
  );
}

export function SidebarBadge() {
  return (
    <Stage>
      <div className="flex w-72 items-center gap-4 rounded-md bg-sidebar p-2">
        <Icon name="Settings" className="size-4 text-muted-foreground" />
        <Icon name="Bug" className="size-4 text-muted-foreground" />
        <span className="ml-auto flex h-6 items-center gap-1.5 rounded-full bg-primary px-2.5 text-xs font-medium text-primary-foreground">
          <Icon name="PackageReceive" className="size-3.5" />
          Updates
        </span>
      </div>
    </Stage>
  );
}
