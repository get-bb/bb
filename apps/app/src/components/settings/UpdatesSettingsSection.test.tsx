// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/desktop-contract";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import type {
  ProviderCliIssue,
  ProviderCliActionableIssue,
} from "@/components/provider-cli/provider-cli-install";
import { useProviderCliInstallRunner } from "@/components/provider-cli/provider-cli-install";
import { resetAppUpdateCheckStoreForTests } from "@/components/settings/app-update-check-store";
import {
  getProviderCliInstallSnapshot,
  resetProviderCliInstallStoreForTests,
} from "@/components/provider-cli/provider-cli-install-store";
import { sdk } from "@/lib/sdk";
import { useDesktopUpdateInfo } from "@/hooks/useDesktopUpdateInfo";
import {
  useUpdateInventory,
  type UpdateInventory,
  type UpdateInventoryMachine,
} from "@/hooks/useUpdateInventory";
import { UpdatesSettingsSection } from "./UpdatesSettingsSection";

vi.mock("@/components/ui/app-toast", () => ({
  appToast: {
    dismiss: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
    message: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/sdk", () => ({
  sdk: { system: { version: vi.fn() } },
}));

vi.mock("@/hooks/useUpdateInventory", () => ({
  useUpdateInventory: vi.fn(),
}));

vi.mock("@/hooks/useDesktopUpdateInfo", () => ({
  useDesktopUpdateInfo: vi.fn(),
}));

const retryHostUpdateMutateMock = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/mutations/host-mutations", () => ({
  useRetryHostUpdate: () => ({
    isPending: false,
    mutate: retryHostUpdateMutateMock,
    variables: undefined,
  }),
}));

const startInstallMock = vi.fn();

vi.mock("@/components/provider-cli/provider-cli-install", async (original) => {
  const actual =
    await original<
      typeof import("@/components/provider-cli/provider-cli-install")
    >();
  return {
    ...actual,
    useProviderCliInstallRunner: vi.fn(() => ({
      failuresByJobKey: new Map(),
      queuedJobKeys: new Set<string>(),
      runningJobKey: null,
      startInstall: startInstallMock,
    })),
  };
});

function makeHost(overrides: Partial<Host> & Pick<Host, "id" | "name">): Host {
  return {
    type: "persistent",
    status: "connected",
    lastSeenAt: Date.now(),
    maxPermissionMode: "full",
    lastRejectedProtocolVersion: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeUpdateIssue(args: {
  provider: "codex" | "claudeCode";
}): ProviderCliActionableIssue {
  const displayName = args.provider === "codex" ? "Codex" : "Claude Code";
  const executableName = args.provider === "codex" ? "codex" : "claude";
  const action = {
    kind: "update" as const,
    label: "Update" as const,
    commandKind: "exec" as const,
    command: `${executableName} update`,
  };
  return {
    provider: args.provider,
    status: {
      displayName,
      executableName,
      executablePath: `/usr/local/bin/${executableName}`,
      installed: true,
      installSource: "npmGlobal",
      currentVersion: "1.0.0",
      latestVersion: "1.0.1",
      minimumSupportedVersion: null,
      npmPackageName: null,
      npmGlobalPackageVersion: null,
      installAction: action,
      needsUpdate: true,
      versionUnsupported: false,
    },
    action,
    title: `${displayName} update available`,
    description: "1.0.0 -> 1.0.1",
    fingerprint: `${args.provider}:outdated`,
  };
}

function makeManualUpdateIssue(args: {
  provider: "codex" | "claudeCode";
}): ProviderCliIssue {
  const issue = makeUpdateIssue(args);
  return {
    ...issue,
    action: null,
    status: {
      ...issue.status,
      installSource: "external",
      installAction: null,
    },
  };
}

function makeMachine(args: {
  host: Host;
  issues?: ProviderCliIssue[];
  isPrimary?: boolean;
  statusPending?: boolean;
  statusError?: boolean;
  canRetryDaemonUpdate?: boolean;
}): UpdateInventoryMachine {
  const issues = args.issues ?? [];
  const upToDate = (provider: "codex" | "claudeCode") => {
    const issue = issues.find((entry) => entry.provider === provider);
    if (issue !== undefined) {
      return issue.status;
    }
    const base = makeUpdateIssue({ provider }).status;
    return {
      ...base,
      latestVersion: base.currentVersion,
      needsUpdate: false,
    };
  };
  const cursorStatus = {
    ...makeUpdateIssue({ provider: "codex" }).status,
    displayName: "Cursor",
    executableName: "agent",
    installed: false,
    currentVersion: null,
    latestVersion: null,
    needsUpdate: false,
    installAction: null,
  };
  return {
    host: args.host,
    isPrimary: args.isPrimary ?? false,
    providerStatus:
      args.host.status === "connected"
        ? {
            codex: upToDate("codex"),
            claudeCode: upToDate("claudeCode"),
            cursor: cursorStatus,
          }
        : null,
    statusPending: args.statusPending ?? false,
    statusError: args.statusError ?? false,
    issues,
    canRetryDaemonUpdate: args.canRetryDaemonUpdate ?? false,
  };
}

function makeInventory(overrides: Partial<UpdateInventory>): UpdateInventory {
  return {
    isLoading: false,
    systemVersion: {
      currentVersion: "0.0.5",
      latestVersion: "0.0.5",
      source: "npm",
      updateAvailable: false,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    },
    desktopInfo: null,
    appUpdateAvailable: false,
    desktopUpdateReady: false,
    machines: [],
    pluginAttentionCount: 0,
    actionableCount: 0,
    hasAttention: false,
    lastCheckedAt: null,
    ...overrides,
  };
}

function renderSection(): void {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <UpdatesSettingsSection />
    </QueryClientProvider>,
  );
}

const useUpdateInventoryMock = vi.mocked(useUpdateInventory);
const useDesktopUpdateInfoMock = vi.mocked(useDesktopUpdateInfo);
const useProviderCliInstallRunnerMock = vi.mocked(useProviderCliInstallRunner);

beforeEach(() => {
  useProviderCliInstallRunnerMock.mockReturnValue({
    failuresByJobKey: new Map(),
    queuedJobKeys: new Set<string>(),
    runningJobKey: null,
    startInstall: startInstallMock,
  });
});

afterEach(() => {
  cleanup();
  resetAppUpdateCheckStoreForTests();
  resetProviderCliInstallStoreForTests();
  vi.clearAllMocks();
});

describe("UpdatesSettingsSection", () => {
  it("keeps a recently checked healthy fleet quiet and accessible", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        lastCheckedAt: Date.now() - 2 * 60 * 1000,
        machines: [
          makeMachine({
            host: makeHost({ id: "host_1", name: "workstation" }),
            isPrimary: true,
          }),
          makeMachine({
            host: makeHost({ id: "host_2", name: "studio-mac" }),
          }),
        ],
      }),
    );

    renderSection();

    expect(screen.getByText("Checked 2m ago")).toBeDefined();
    expect(screen.getByText("2 machines, all in sync")).toBeDefined();
    expect(screen.queryByText("Up to date")).toBeNull();
    expect(screen.queryByText(/^In sync$/)).toBeNull();
    expect(
      screen.getByRole("group", { name: /workstation, Connected/ }),
    ).toBeDefined();
  });

  it("does not call an offline fleet all in sync", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: makeHost({
              id: "host_1",
              name: "homelab",
              status: "disconnected",
            }),
          }),
        ],
      }),
    );

    renderSection();

    expect(screen.getByText("1 machine was not checked")).toBeDefined();
    expect(screen.queryByText(/all in sync/)).toBeNull();
    expect(
      within(screen.getByRole("group", { name: /homelab, Offline/ })).getByText(
        "Offline — connect to check for updates",
      ),
    ).toBeDefined();
  });

  it("explains and retries a stranded daemon update", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({
      id: "host_1",
      name: "homelab",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
    });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            canRetryDaemonUpdate: true,
          }),
        ],
      }),
    );

    renderSection();

    expect(screen.getByText("1 machine can't connect")).toBeDefined();
    expect(
      screen.getByText("Can't connect — its bb agent is out of date"),
    ).toBeDefined();
    expect(
      screen.getByText(
        `Needs update · daemon protocol ${HOST_DAEMON_PROTOCOL_VERSION - 1} · server protocol ${HOST_DAEMON_PROTOCOL_VERSION}`,
      ),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Retry update" }));
    expect(retryHostUpdateMutateMock).toHaveBeenCalledWith(
      host.id,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("removes running and queued provider jobs from Update all", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    const codexIssue = makeUpdateIssue({ provider: "codex" });
    const claudeIssue = makeUpdateIssue({ provider: "claudeCode" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [codexIssue, claudeIssue] })],
      }),
    );
    useProviderCliInstallRunnerMock.mockReturnValue({
      failuresByJobKey: new Map(),
      queuedJobKeys: new Set(["host_1:claudeCode"]),
      runningJobKey: "host_1:codex",
      startInstall: startInstallMock,
    });

    renderSection();

    expect(screen.queryByRole("button", { name: /Update all/ })).toBeNull();
    expect(screen.getByText("2 updates in progress")).toBeDefined();
    expect(screen.getByText("Running…")).toBeDefined();
    expect(screen.getByText("Queued")).toBeDefined();
  });

  it("keeps a provider update failure and its command log on the row", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    const issue = makeUpdateIssue({ provider: "claudeCode" });
    const logDialogState = {
      displayName: "Claude Code",
      log: "$ claude update\npermission denied\n",
      message: "Command exited with code 1",
      title: "Claude Code update log",
    };
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [issue] })],
      }),
    );
    useProviderCliInstallRunnerMock.mockReturnValue({
      failuresByJobKey: new Map([
        [
          "host_1:claudeCode",
          { issueFingerprint: issue.fingerprint, logDialogState },
        ],
      ]),
      queuedJobKeys: new Set(),
      runningJobKey: null,
      startInstall: startInstallMock,
    });

    renderSection();

    expect(screen.getByText("Failed")).toBeDefined();
    expect(screen.getByRole("alert").textContent).toBe(
      "Command exited with code 1",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "View log" }));
    expect(getProviderCliInstallSnapshot().logDialogState).toEqual(
      logDialogState,
    );
  });

  it("forces the web update check and shows the upgrade command inline", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const availableVersion = {
      currentVersion: "0.0.5",
      latestVersion: "0.0.6",
      source: "npm" as const,
      updateAvailable: true,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    };
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        systemVersion: availableVersion,
        appUpdateAvailable: true,
        actionableCount: 1,
        hasAttention: true,
      }),
    );
    vi.mocked(sdk.system.version).mockResolvedValue(availableVersion);

    renderSection();
    expect(screen.getByText("npx bb-app@latest")).toBeDefined();
    expect(screen.getByText("0.0.6")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => {
      expect(sdk.system.version).toHaveBeenCalledWith({ force: true });
    });
  });

  it("checks for desktop updates through the desktop bridge", async () => {
    const desktopInfo: BbDesktopInfo = {
      downloadState: "downloaded",
      lastCheckedAt: null,
      latestVersion: "0.0.6",
      pendingVersion: "0.0.6",
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: true,
      version: "0.0.5",
    };
    const checkForUpdates = vi.fn().mockResolvedValue(desktopInfo);
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: { checkForUpdates } as unknown as BbDesktopApi,
      desktopInfo,
      isDesktop: true,
    });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        desktopInfo,
        desktopUpdateReady: true,
        actionableCount: 1,
        hasAttention: true,
      }),
    );

    renderSection();
    expect(screen.getByRole("button", { name: "Relaunch" })).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Check for updates" }));
    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
    });
    expect(sdk.system.version).not.toHaveBeenCalled();
  });

  it("does not claim a legacy desktop shell is downloading an available update", () => {
    const desktopInfo: BbDesktopInfo = {
      lastCheckedAt: null,
      latestVersion: "0.0.6",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.5",
    };
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: {} as BbDesktopApi,
      desktopInfo,
      isDesktop: true,
    });
    useUpdateInventoryMock.mockReturnValue(makeInventory({ desktopInfo }));

    renderSection();

    expect(screen.getByText("Available")).toBeDefined();
    expect(screen.queryByText("Downloading in the background…")).toBeNull();
  });

  it("retries a failed desktop download through the desktop bridge", async () => {
    const desktopInfo: BbDesktopInfo = {
      downloadState: "failed",
      lastCheckedAt: null,
      latestVersion: "0.0.6",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: true,
      updateDownloaded: false,
      version: "0.0.5",
    };
    const checkForUpdates = vi.fn().mockResolvedValue(desktopInfo);
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: { checkForUpdates } as unknown as BbDesktopApi,
      desktopInfo,
      isDesktop: true,
    });
    useUpdateInventoryMock.mockReturnValue(makeInventory({ desktopInfo }));

    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
    });
  });

  it("runs every actionable provider update across machines from Update all", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const laptop = makeHost({ id: "host_1", name: "laptop" });
    const homelab = makeHost({ id: "host_2", name: "homelab" });
    const laptopIssue = makeUpdateIssue({ provider: "codex" });
    const homelabIssue = makeUpdateIssue({ provider: "claudeCode" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({ host: laptop, issues: [laptopIssue] }),
          makeMachine({ host: homelab, issues: [homelabIssue] }),
        ],
        actionableCount: 2,
        hasAttention: true,
      }),
    );

    renderSection();
    expect(useProviderCliInstallRunnerMock).toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Update all (2)" }));
    expect(startInstallMock).toHaveBeenCalledTimes(2);
    expect(startInstallMock).toHaveBeenNthCalledWith(1, {
      hostId: "host_1",
      issue: laptopIssue,
    });
    expect(startInstallMock).toHaveBeenNthCalledWith(2, {
      hostId: "host_2",
      issue: homelabIssue,
    });
  });

  it("shows an external Claude installation as a manual update without an update button", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    const issue = makeManualUpdateIssue({ provider: "claudeCode" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [issue] })],
        actionableCount: 1,
        hasAttention: true,
      }),
    );

    renderSection();

    expect(screen.getByText("Update manually")).toBeDefined();
    expect(screen.getByText("1 update needs manual action")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Update all/ })).toBeNull();
  });
});
