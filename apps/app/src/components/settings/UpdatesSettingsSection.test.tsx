// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/desktop-contract";
import type {
  ProviderCliIssue,
  ProviderCliActionableIssue,
} from "@/components/provider-cli/provider-cli-install";
import { useProviderCliInstallRunner } from "@/components/provider-cli/provider-cli-install";
import { resetAppUpdateCheckStoreForTests } from "@/components/settings/app-update-check-store";
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

vi.mock("@/hooks/mutations/host-mutations", () => ({
  useRetryHostUpdate: () => ({
    isPending: false,
    mutate: vi.fn(),
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

function makeMachine(args: {
  host: Host;
  issues?: ProviderCliIssue[];
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
    isPrimary: false,
    providerStatus:
      args.host.status === "connected"
        ? {
            codex: upToDate("codex"),
            claudeCode: upToDate("claudeCode"),
            cursor: cursorStatus,
          }
        : null,
    statusPending: false,
    statusError: false,
    issues,
    canRetryDaemonUpdate: false,
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
    actionableCount: 0,
    hasAttention: false,
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

afterEach(() => {
  cleanup();
  resetAppUpdateCheckStoreForTests();
  vi.clearAllMocks();
});

describe("UpdatesSettingsSection", () => {
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
});
