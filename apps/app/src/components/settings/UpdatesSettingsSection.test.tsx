// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Host } from "@bb/domain";
import { makeHost as makeHostFixture } from "@bb/test-helpers/domain-fixtures";
import type { BbDesktopApi, BbDesktopInfo } from "@bb/desktop-contract";
import { BbHttpError } from "@bb/sdk/browser";
import type { SystemAppUpdateStatus } from "@bb/server-contract";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  type ProviderCliKey,
} from "@bb/host-daemon-contract";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
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
import { appToast } from "@/components/ui/app-toast";
import { sdk } from "@/lib/sdk";
import { useDesktopUpdateInfo } from "@/hooks/useDesktopUpdateInfo";
import {
  useUpdateInventory,
  type UpdateInventory,
  type UpdateInventoryMachine,
} from "@/hooks/useUpdateInventory";
import {
  UpdateActionButton,
  UpdatesSettingsSection,
} from "./UpdatesSettingsSection";

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

vi.mock("@/lib/sdk", async () => {
  const { makeProviderInfo } = await import("@bb/test-helpers/domain-fixtures");
  const { makeSystemConfig } = await import("@/test/fixtures/system-config");
  return {
    sdk: {
      system: {
        acknowledgeAppUpdate: vi.fn(),
        appUpdate: vi.fn(),
        applyAppUpdate: vi.fn(),
        version: vi.fn(),
        config: vi.fn(async () =>
          makeSystemConfig({ primaryHostId: "host_primary" }),
        ),
      },
      providers: {
        list: vi.fn(async () => [
          makeProviderInfo({ id: "codex", displayName: "Codex" }),
          makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
          makeProviderInfo({ id: "acp-cursor", displayName: "Cursor" }),
        ]),
      },
    },
  };
});

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

vi.mock("@/hooks/useUpdateInventory", () => ({
  useUpdateInventory: vi.fn(),
}));

vi.mock("@/hooks/useDesktopUpdateInfo", () => ({
  useDesktopUpdateInfo: vi.fn(),
}));

vi.mock("@/components/settings/WhatsNewSection", () => ({
  WhatsNewSection: ({
    installedVersion,
    availableVersion,
  }: {
    installedVersion: string | null;
    availableVersion: string | null;
  }) => (
    <div
      data-testid="whats-new"
      data-installed-version={installedVersion ?? ""}
      data-available-version={availableVersion ?? ""}
    />
  ),
}));

const hostDaemon = vi.hoisted(() => ({
  localDaemonHostId: null as string | null,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({
    localDaemonHostId: hostDaemon.localDaemonHostId,
  }),
}));

const openUrlInExternalBrowserMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/url-open-routing", () => ({
  openUrlInExternalBrowser: openUrlInExternalBrowserMock,
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
  return makeHostFixture({
    lastSeenAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });
}

function makeUpdateIssue(args: {
  provider: ProviderCliKey;
}): ProviderCliActionableIssue {
  const identity =
    args.provider === "codex"
      ? { displayName: "Codex", executableName: "codex" }
      : args.provider === "claude-code"
        ? { displayName: "Claude Code", executableName: "claude" }
        : { displayName: "Cursor", executableName: "agent" };
  const { displayName, executableName } = identity;
  const action = {
    kind: "update" as const,
    label: "Update" as const,
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
  provider: "codex" | "claude-code";
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
  const upToDate = (provider: ProviderCliKey) => {
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
  const cursorIssue = issues.find((entry) => entry.provider === "acp-cursor");
  const cursorStatus =
    cursorIssue?.status ??
    ({
      ...makeUpdateIssue({ provider: "acp-cursor" }).status,
      installed: false,
      currentVersion: null,
      latestVersion: null,
      needsUpdate: false,
      installAction: null,
    } as const);
  return {
    host: args.host,
    isPrimary: args.isPrimary ?? false,
    providerStatus:
      args.host.status === "connected"
        ? {
            codex: upToDate("codex"),
            "claude-code": upToDate("claude-code"),
            "acp-cursor": cursorStatus,
          }
        : null,
    statusPending: args.statusPending ?? false,
    statusFetching: args.statusPending ?? false,
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
      currentCommit: null,
      installKind: "npm",
      source: "npm",
      updateAvailable: false,
      isDevelopment: false,
      upgradeCommand: "npx bb-app@latest",
    },
    desktopInfo: null,
    appUpdateAvailable: false,
    desktopUpdateReady: false,
    machines: [
      makeMachine({
        host: makeHost({ id: "host_primary", name: "workstation" }),
        isPrimary: true,
      }),
    ],
    pluginAttentionCount: 0,
    actionableCount: 0,
    hasAttention: false,
    lastCheckedAt: null,
    ...overrides,
  };
}

function renderSection(): void {
  render(
    <MemoryRouter>
      <TooltipProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <UpdatesSettingsSection />
        </QueryClientProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const useUpdateInventoryMock = vi.mocked(useUpdateInventory);
const useDesktopUpdateInfoMock = vi.mocked(useDesktopUpdateInfo);
const useProviderCliInstallRunnerMock = vi.mocked(useProviderCliInstallRunner);

function makeAppUpdateStatus(
  overrides: Partial<SystemAppUpdateStatus> = {},
): SystemAppUpdateStatus {
  return {
    activity: { phase: "idle" },
    available: {
      channel: "latest",
      commit: null,
      commitCount: null,
      subjects: [],
      version: "0.0.6",
    },
    blocked: null,
    current: { commit: null, version: "0.0.5" },
    lastResult: null,
    runningThreadCount: 0,
    support: { kind: "supported", mode: "npm" },
    ...overrides,
  };
}

function useWebApp(): void {
  useDesktopUpdateInfoMock.mockReturnValue({
    desktopApi: null,
    desktopInfo: null,
    isDesktop: false,
  });
  useUpdateInventoryMock.mockReturnValue(makeInventory({}));
  vi.mocked(sdk.system.version).mockResolvedValue({
    currentVersion: "0.0.5",
    isDevelopment: false,
    latestVersion: "0.0.6",
    currentCommit: null,
    installKind: "npm",
    source: "npm",
    updateAvailable: true,
    upgradeCommand: "npx bb-app@latest",
  });
}

beforeEach(() => {
  hostDaemon.localDaemonHostId = null;
  vi.mocked(sdk.system.appUpdate).mockResolvedValue(
    makeAppUpdateStatus({
      available: null,
      support: { kind: "unsupported", reason: "unmanaged" },
    }),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockRejectedValue(new Error("Changelog unavailable offline")),
  );
  useProviderCliInstallRunnerMock.mockReturnValue({
    failuresByJobKey: new Map(),
    queuedJobKeys: new Set<string>(),
    runningJobKey: null,
    startInstall: startInstallMock,
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  window.localStorage.clear();
  resetAppUpdateCheckStoreForTests();
  resetProviderCliInstallStoreForTests();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("UpdatesSettingsSection", () => {
  it("checks for updates once when the view mounts", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({ machines: [makeMachine({ host })] }),
    );
    vi.mocked(sdk.system.version).mockResolvedValue(
      makeInventory({}).systemVersion!,
    );

    renderSection();

    expect(screen.queryByRole("button", { name: /check/i })).toBeNull();
    await waitFor(() => {
      expect(sdk.system.version).toHaveBeenCalledWith({ force: true });
    });
    expect(sdk.system.version).toHaveBeenCalledTimes(1);
  });

  it("places fleet-wide Update all beside the Provider CLIs heading", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: makeHost({ id: "host_1", name: "workstation" }),
            issues: [makeUpdateIssue({ provider: "codex" })],
          }),
          makeMachine({
            host: makeHost({ id: "host_2", name: "homelab" }),
            issues: [makeUpdateIssue({ provider: "claude-code" })],
          }),
        ],
      }),
    );

    renderSection();

    const bulkActions = screen.getByRole("toolbar", {
      name: "Bulk update actions",
    });
    const updateAll = bulkActions.querySelector(
      '[aria-label="Update all 2 CLI tools"]',
    );
    expect(updateAll).not.toBeNull();
    expect(updateAll?.className).toContain("bg-foreground");
    expect(updateAll?.className).toContain("text-background");
    expect(updateAll?.textContent).toBe("Update all");
    expect(updateAll?.firstElementChild?.getAttribute("data-icon")).toBe(
      "Download",
    );
    const fleetSection = screen
      .getByRole("heading", { name: "Provider CLIs" })
      .closest("section");
    const fleetHeader = fleetSection?.firstElementChild;
    const fleetBody = fleetSection?.children.item(1);
    const machineRows = document.querySelectorAll("[data-updates-machine]");
    expect(machineRows).toHaveLength(2);
    expect(fleetHeader?.contains(bulkActions)).toBe(true);
    for (const row of machineRows) {
      expect(fleetBody?.contains(row)).toBe(true);
      expect(row.contains(bulkActions)).toBe(false);
    }
    expect(screen.queryByRole("heading", { name: "workstation" })).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Machine updates" }),
    ).toBeNull();
  });

  it("shows What's new after the update rows for the installed and available releases", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const inventory = makeInventory({});
    useUpdateInventoryMock.mockReturnValue({
      ...inventory,
      systemVersion: {
        ...inventory.systemVersion!,
        currentVersion: "0.0.5",
        latestVersion: "0.0.6",
        updateAvailable: true,
      },
    });

    renderSection();

    const whatsNew = screen.getByTestId("whats-new");
    expect(whatsNew.getAttribute("data-installed-version")).toBe("0.0.5");
    expect(whatsNew.getAttribute("data-available-version")).toBe("0.0.6");
    const bbUpdates = document.querySelector('[data-updates-domain="bb"]');
    expect(bbUpdates).not.toBeNull();
    expect(
      bbUpdates!.compareDocumentPosition(whatsNew) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("omits the available release when bb is up to date", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    useUpdateInventoryMock.mockReturnValue(makeInventory({}));

    renderSection();

    const whatsNew = screen.getByTestId("whats-new");
    expect(whatsNew.getAttribute("data-installed-version")).toBe("0.0.5");
    expect(whatsNew.getAttribute("data-available-version")).toBe("");
  });

  it("keeps a recently checked healthy fleet quiet and accessible", async () => {
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

    await waitFor(() => {
      expect(
        screen
          .getAllByText("Up to date")
          .every((label) => label.className.includes("sr-only")),
      ).toBe(true);
    });
    expect(screen.queryByText("2 up to date")).toBeNull();
    expect(
      screen.getByText("Nothing to update on all 2 machines."),
    ).toBeDefined();
    expect(document.querySelector("[data-updates-machine]")).toBeNull();
    expect(screen.queryByText("workstation")).toBeNull();
    expect(screen.queryByText("This machine")).toBeNull();
    expect(screen.queryByText("Codex")).toBeNull();
    expect(screen.queryByText(/Checked/)).toBeNull();
    expect(screen.queryByText(/ago$/)).toBeNull();
    expect(screen.queryByText(/^In sync$/)).toBeNull();
    expect(screen.queryByText("workstation, studio-mac")).toBeNull();
    expect(screen.queryByRole("button", { name: /check/i })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Updates" })).toBeNull();
    const settledRows = screen.getAllByText(/^Up to date/);
    expect(
      settledRows.every(
        (settled) =>
          settled.parentElement?.querySelector(".bg-success") === null,
      ),
    ).toBe(true);
    expect(document.querySelector(".bg-success")).toBeNull();
    expect(
      document
        .querySelector(
          '[data-update-state="up-to-date"] [data-icon="CircleCheck"]',
        )
        ?.getAttribute("class"),
    ).toContain("text-input");
    expect(
      document
        .querySelector(
          '[data-update-state="up-to-date"] [data-icon="CircleCheck"]',
        )
        ?.getAttribute("class"),
    ).not.toContain("opacity-");
  });

  it("does not claim up to date when the latest version is unknown", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const machine = makeMachine({
      host: makeHost({ id: "host_1", name: "workstation" }),
      isPrimary: true,
    });
    const codex = machine.providerStatus!.codex;
    machine.providerStatus!.codex = { ...codex, latestVersion: null };
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({ lastCheckedAt: Date.now(), machines: [machine] }),
    );

    renderSection();

    expect(screen.getByText("Nothing to update on workstation.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Show machines" }));
    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    const codexRow = document.querySelector('[data-provider-row="codex"]');
    expect(codexRow?.textContent).toContain("Latest unknown");
    expect(
      codexRow?.querySelector('[data-update-state="up-to-date"]'),
    ).toBeNull();
  });

  it("does not call an offline fleet all in sync", async () => {
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

    expect(screen.getByText("homelab is offline.")).toBeDefined();
    expect(screen.queryByText(/Nothing to update/)).toBeNull();
    expect(screen.queryByText(/all in sync/)).toBeNull();
    expect(document.querySelector("[data-updates-machine]")).toBeNull();
    expect(
      document.querySelector('[data-bb-update-role="app"]'),
    ).not.toBeNull();
    expect(screen.getByText("Server")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Show machines" }));
    const row = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_1"]',
    );
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("Offline")).toBeDefined();
    expect(
      within(row as HTMLElement).queryByRole("button", { name: "homelab" }),
    ).toBeNull();
    await waitFor(() => {
      expect(screen.getByText(/^Up to date/)).toBeDefined();
    });
  });

  it("lists only machines that need attention and folds the rest into the footer", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const stalledHost = makeHost({
      id: "host_3",
      name: "homelab",
      status: "disconnected",
      lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
      updatedAt: Date.now() - 3 * 60 * 1000,
    });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: makeHost({ id: "host_1", name: "workstation" }),
          }),
          makeMachine({
            host: makeHost({
              id: "host_2",
              name: "studio-mac",
              status: "disconnected",
            }),
          }),
          makeMachine({
            host: stalledHost,
            canRetryDaemonUpdate: true,
          }),
        ],
      }),
    );

    renderSection();

    expect(document.querySelectorAll("[data-updates-machine]")).toHaveLength(1);
    expect(screen.getByText("homelab")).toBeDefined();
    expect(screen.queryByText("workstation")).toBeNull();
    expect(screen.queryByText("studio-mac")).toBeNull();
    expect(
      screen.getByText("2 other machines have nothing to update"),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^Failed · Retry on/ }),
    ).toBeDefined();

    const showAll = screen.getByRole("button", { name: "Show all" });
    expect(showAll.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(showAll);

    expect(
      [...document.querySelectorAll("[data-updates-machine]")].map((row) =>
        row.getAttribute("data-updates-machine"),
      ),
    ).toEqual(["host_3", "host_1", "host_2"]);
    expect(screen.getByText("Offline")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(document.querySelectorAll("[data-updates-machine]")).toHaveLength(1);
  });

  it("treats a recent daemon protocol mismatch as an automatic update", () => {
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

    const row = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_1"]',
    );
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getByText("homelab")).toBeDefined();
    expect(within(row as HTMLElement).getByText("Updating bb")).toBeDefined();
    expect(
      row?.querySelector('[data-update-state="in-progress"]'),
    ).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
    expect(screen.queryByText(/can't connect/i)).toBeNull();
    expect(screen.queryByText("Offline")).toBeNull();
  });

  it("explains and retries a daemon update that has stalled", () => {
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
      updatedAt: Date.now() - 3 * 60 * 1000,
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

    expect(screen.getByText("homelab")).toBeDefined();
    expect(screen.queryByText("1 needs attention")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Failed · Retry on homelab now" }),
    ).toBeDefined();
    expect(screen.queryByText("1 machine needs attention")).toBeNull();
    expect(screen.queryByText(/daemon protocol/)).toBeNull();
    expect(
      document.querySelector('[data-updates-machine="host_1"]')?.innerHTML,
    ).not.toContain("bg-surface-destructive");
    expect(screen.queryByText(/^Up to date/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Update didn't finish").className).toContain(
      "text-destructive",
    );
    expect(
      screen.getAllByRole("button", { name: /^Failed · Retry on/ }),
    ).toHaveLength(1);

    expect(
      screen.queryByRole("button", { name: /Update all .* machines now/ }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Failed · Retry on homelab now",
      }),
    );
    expect(retryHostUpdateMutateMock).toHaveBeenCalledWith(
      host.id,
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("names a machine running a newer bb than the server", () => {
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
              lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
            }),
            canRetryDaemonUpdate: false,
          }),
        ],
      }),
    );

    renderSection();

    expect(screen.getByText("Update this app to reconnect")).toBeDefined();
    expect(
      screen.queryByRole("button", { name: /Update homelab now/ }),
    ).toBeNull();
  });

  it("sweeps every machine stalled on the same bb update", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const stalled = ["workstation", "studio-mac", "homelab"].map(
      (name, index) =>
        makeHost({
          id: `host_${index}`,
          name,
          status: "disconnected",
          lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION - 1,
          updatedAt: Date.now() - 3 * 60 * 1000,
        }),
    );
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: stalled.map((host) =>
          makeMachine({ host, canRetryDaemonUpdate: true }),
        ),
      }),
    );

    renderSection();

    expect(screen.queryByText(/^Up to date/)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Update all 3 machines now",
      }),
    );
    expect(retryHostUpdateMutateMock).toHaveBeenCalledTimes(3);
    for (const host of stalled) {
      expect(retryHostUpdateMutateMock).toHaveBeenCalledWith(host.id);
    }
    expect(
      screen.getByRole("button", {
        name: "Failed · Retry on studio-mac now",
      }),
    ).toBeDefined();
  });

  it("shows one line per machine and its installed CLIs when expanded", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    const codexIssue = makeUpdateIssue({ provider: "codex" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({ host, issues: [codexIssue], isPrimary: true }),
        ],
      }),
    );

    renderSection();

    const row = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_1"]',
    );
    if (row === null) throw new Error("expected the machine row");
    expect(screen.getAllByText("workstation")).toHaveLength(1);
    expect(row.querySelector('[data-icon="Laptop"]')).not.toBeNull();
    expect(
      [...row.querySelectorAll("[data-provider-avatar]")].map((avatar) =>
        avatar.getAttribute("data-provider-avatar"),
      ),
    ).toEqual(["codex"]);
    expect(row.querySelector("[data-updates-machine-detail]")).toBeNull();
    expect(screen.queryByText("Codex")).toBeNull();
    expect(screen.queryByText(/^Update available/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Update Codex on workstation/ }),
    ).toBeNull();

    const toggle = screen.getByRole("button", { name: "workstation" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const detail = row.querySelector<HTMLElement>(
      "[data-updates-machine-detail]",
    );
    if (detail === null) throw new Error("expected the expanded detail");
    expect(toggle.getAttribute("aria-controls")).toBe(detail.id);

    expect(
      [...detail.querySelectorAll("[data-provider-row]")].map((entry) =>
        entry.getAttribute("data-provider-row"),
      ),
    ).toEqual(["codex", "claude-code"]);
    expect(within(detail).queryByText("Cursor")).toBeNull();
    const claudeRow = detail.querySelector('[data-provider-row="claude-code"]');
    expect(
      claudeRow?.querySelector('[data-update-state="up-to-date"]'),
    ).not.toBeNull();
    expect(claudeRow?.querySelector("[data-provider-updater]")).toBeNull();
    const codexRow = detail.querySelector('[data-provider-row="codex"]');
    expect(
      codexRow?.querySelector("[data-provider-updater]")?.textContent,
    ).toBe("Built-in updater");
    await waitFor(() => {
      expect(
        codexRow?.querySelector(
          '[data-provider-icon="codex"] [data-provider-logo]',
        ),
      ).not.toBeNull();
    });
    const versionMetadata = codexRow?.querySelector("[data-version-metadata]");
    expect(versionMetadata?.className).toContain("text-2xs");
    expect(versionMetadata?.className).not.toContain("font-mono");
    const upgrade = versionMetadata?.querySelector(".text-version-upgrade");
    expect(upgrade?.textContent).toBe("1.0.1");
    expect(upgrade?.className).toContain("font-semibold");
    expect(
      claudeRow?.querySelector("[data-version-metadata]")?.textContent,
    ).toBe("1.0.0");

    fireEvent.click(screen.getByRole("button", { name: "Update workstation" }));
    expect(startInstallMock).toHaveBeenCalledTimes(1);
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host_1",
      issue: codexIssue,
    });

    fireEvent.click(toggle);
    expect(row.querySelector("[data-updates-machine-detail]")).toBeNull();
  });

  it("names the updater from the command the machine reports", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    const withCommand = (
      provider: "codex" | "claude-code",
      command: string,
    ): ProviderCliActionableIssue => {
      const issue = makeUpdateIssue({ provider });
      const action = { ...issue.action, command };
      return {
        ...issue,
        action,
        status: { ...issue.status, installAction: action },
      };
    };
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            issues: [
              withCommand("codex", "mise upgrade npm:@openai/codex"),
              withCommand(
                "claude-code",
                "/opt/homebrew/bin/brew upgrade claude-code",
              ),
            ],
          }),
        ],
      }),
    );

    renderSection();
    fireEvent.click(screen.getByRole("button", { name: "workstation" }));

    expect(
      [...document.querySelectorAll("[data-provider-updater]")].map(
        (label) => label.textContent,
      ),
    ).toEqual(["mise", "Homebrew"]);
  });

  it("badges the client-local daemon independently from the server machine", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const primary = makeHost({ id: "host_primary", name: "workstation" });
    const local = makeHost({ id: "host_local", name: "studio-mac" });
    hostDaemon.localDaemonHostId = local.id;
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: primary,
            issues: [makeUpdateIssue({ provider: "codex" })],
            isPrimary: true,
          }),
          makeMachine({
            host: local,
            issues: [makeUpdateIssue({ provider: "claudeCode" })],
          }),
        ],
      }),
    );

    renderSection();

    const primaryHeading = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_primary"]',
    )!;
    const localHeading = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_local"]',
    )!;
    await waitFor(() => {
      expect(
        within(primaryHeading)
          .getByText("Server")
          .hasAttribute("data-machine-tag"),
      ).toBe(true);
    });
    expect(primaryHeading.textContent).not.toContain("This machine");
    expect(localHeading.textContent).toContain("This machine");
    expect(within(localHeading).queryByText("Server")).toBeNull();
  });

  it("badges a lone server machine without marking it as this machine", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const primary = makeHost({ id: "host_primary", name: "workstation" });
    hostDaemon.localDaemonHostId = primary.id;
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host: primary,
            issues: [makeUpdateIssue({ provider: "codex" })],
            isPrimary: true,
          }),
        ],
      }),
    );

    renderSection();

    const primaryHeading = document.querySelector<HTMLElement>(
      '[data-updates-machine="host_primary"]',
    )!;
    await waitFor(() => {
      expect(
        within(primaryHeading)
          .getByText("Server")
          .hasAttribute("data-machine-tag"),
      ).toBe(true);
    });
    expect(primaryHeading.textContent).not.toContain("This machine");
  });

  it("lists Cursor updates with the other provider CLIs", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    const cursorIssue = makeUpdateIssue({ provider: "acp-cursor" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [cursorIssue] })],
      }),
    );

    renderSection();

    expect(
      document.querySelector('[data-provider-avatar="acp-cursor"]'),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(
      document.querySelector('[data-provider-row="acp-cursor"]')?.textContent,
    ).toContain("Cursor");
    fireEvent.click(screen.getByRole("button", { name: "Update workstation" }));
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host_1",
      issue: cursorIssue,
    });
  });

  it("piles every outdated CLI onto its machine's single line", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            issues: [
              makeUpdateIssue({ provider: "codex" }),
              makeUpdateIssue({ provider: "claude-code" }),
            ],
          }),
        ],
      }),
    );

    renderSection();

    expect(screen.getAllByText("workstation")).toHaveLength(1);
    const row = document.querySelector('[data-updates-machine="host_1"]');
    expect(
      [...(row?.querySelectorAll("[data-provider-avatar]") ?? [])].map(
        (avatar) => avatar.getAttribute("data-provider-avatar"),
      ),
    ).toEqual(["codex", "claude-code"]);
    expect(row?.querySelector("[data-provider-manual]")).toBeNull();
    expect(row?.querySelector("[data-provider-activity]")).toBeNull();
    fireEvent.click(
      row?.querySelector('[data-provider-avatar="codex"]') as HTMLElement,
    );
    expect(
      row?.querySelectorAll("[data-provider-row] [data-version-metadata]")
        .length,
    ).toBe(2);
  });

  it("shows one quiet line while provider checks are still running", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, statusPending: true })],
      }),
    );

    renderSection();

    const summary = document.querySelector("[data-updates-summary]");
    expect(summary?.textContent).toBe("Checking for updates…");
    expect(summary?.querySelector('[data-icon="Loading"]')).not.toBeNull();
    expect(screen.queryByText(/Nothing to update/)).toBeNull();
    expect(document.querySelector("[data-updates-machine]")).toBeNull();
  });

  it("ignores repeat Retry clicks while the retry is running", () => {
    const onClick = vi.fn();
    render(
      <TooltipProvider>
        <UpdateActionButton
          label="Retry on homelab now"
          icon="RotateCcw"
          loading
          onClick={onClick}
        />
      </TooltipProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Retry on homelab now" }),
    );

    expect(onClick).not.toHaveBeenCalled();
  });

  it("keeps error red on the reason and off the recovery", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, statusError: true })],
      }),
    );

    renderSection();

    expect(screen.getByText("Couldn't check for updates").className).toContain(
      "text-destructive",
    );
    const retry = screen.getByRole("button", {
      name: /Check workstation's CLIs again/,
    });
    expect(retry.className).not.toContain("text-destructive");
    expect(retry.hasAttribute("disabled")).toBe(false);
  });

  it("leaves never-installed CLIs off an update page", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    const missingCodex = makeUpdateIssue({ provider: "codex" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            issues: [
              {
                ...missingCodex,
                status: {
                  ...missingCodex.status,
                  installed: false,
                  currentVersion: null,
                },
              },
              makeUpdateIssue({ provider: "claude-code" }),
            ],
          }),
        ],
      }),
    );

    renderSection();

    expect(
      [...document.querySelectorAll("[data-provider-avatar]")].map((avatar) =>
        avatar.getAttribute("data-provider-avatar"),
      ),
    ).toEqual(["claude-code"]);
    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(screen.getByText("Claude Code")).toBeDefined();
    expect(screen.queryByText("Codex")).toBeNull();
  });

  it("swaps Update all for progress while every job is running or queued", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    const codexIssue = makeUpdateIssue({ provider: "codex" });
    const claudeIssue = makeUpdateIssue({ provider: "claude-code" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [codexIssue, claudeIssue] })],
      }),
    );
    useProviderCliInstallRunnerMock.mockReturnValue({
      failuresByJobKey: new Map(),
      queuedJobKeys: new Set(["host_1:claude-code"]),
      runningJobKey: "host_1:codex",
      startInstall: startInstallMock,
    });

    renderSection();

    expect(screen.queryByRole("button", { name: /Update all/ })).toBeNull();
    expect(document.querySelector("[data-updates-progress]")?.textContent).toBe(
      "Updating 1 of 2",
    );
    expect(
      document
        .querySelector('[data-provider-avatar="codex"]')
        ?.getAttribute("data-provider-activity"),
    ).toBe("running");
    expect(
      document
        .querySelector('[data-provider-avatar="claude-code"]')
        ?.getAttribute("data-provider-activity"),
    ).toBe("queued");

    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(
      document.querySelectorAll(
        '[data-updates-machine="host_1"] [data-provider-row] [data-update-state="in-progress"]',
      ).length,
    ).toBe(2);
    expect(
      screen.queryByRole("button", { name: "Update workstation" }),
    ).toBeNull();
  });

  it("counts progress through an Update all batch", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [
          makeMachine({
            host,
            issues: [
              makeUpdateIssue({ provider: "codex" }),
              makeUpdateIssue({ provider: "claude-code" }),
              makeUpdateIssue({ provider: "acp-cursor" }),
            ],
          }),
        ],
      }),
    );
    const runner = (runningJobKey: string | null, queued: string[]) => ({
      failuresByJobKey: new Map(),
      queuedJobKeys: new Set(queued),
      runningJobKey,
      startInstall: startInstallMock,
    });
    const queryClient = new QueryClient();
    const tree = () => (
      <MemoryRouter>
        <TooltipProvider>
          <QueryClientProvider client={queryClient}>
            <UpdatesSettingsSection />
          </QueryClientProvider>
        </TooltipProvider>
      </MemoryRouter>
    );
    const progress = () =>
      document.querySelector("[data-updates-progress]")?.textContent ?? null;

    useProviderCliInstallRunnerMock.mockReturnValue(
      runner("host_1:codex", ["host_1:claude-code", "host_1:acp-cursor"]),
    );
    const view = render(tree());
    expect(progress()).toBe("Updating 1 of 3");

    useProviderCliInstallRunnerMock.mockReturnValue(
      runner("host_1:claude-code", ["host_1:acp-cursor"]),
    );
    view.rerender(tree());
    expect(progress()).toBe("Updating 2 of 3");

    useProviderCliInstallRunnerMock.mockReturnValue(
      runner("host_1:acp-cursor", []),
    );
    view.rerender(tree());
    expect(progress()).toBe("Updating 3 of 3");

    useProviderCliInstallRunnerMock.mockReturnValue(runner(null, []));
    view.rerender(tree());
    expect(progress()).toBeNull();
    expect(
      screen.getByRole("button", { name: "Update all 3 CLI tools" }),
    ).toBeDefined();
  });

  it("keeps a provider update failure and its command log on the machine", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const host = makeHost({ id: "host_1", name: "workstation" });
    const issue = makeUpdateIssue({ provider: "claude-code" });
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
          "host_1:claude-code",
          {
            issueFingerprint: issue.fingerprint,
            kind: "interrupted",
            logDialogState,
          },
        ],
      ]),
      queuedJobKeys: new Set(),
      runningJobKey: null,
      startInstall: startInstallMock,
    });

    renderSection();

    expect(screen.getByText("Claude Code failed").className).toContain(
      "text-destructive",
    );
    expect(
      document
        .querySelector('[data-provider-avatar="claude-code"]')
        ?.getAttribute("data-provider-activity"),
    ).toBe("failed");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Failed · Retry failed updates on workstation",
      }),
    );
    expect(startInstallMock).toHaveBeenCalledWith({ hostId: "host_1", issue });

    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(
      screen.getByText("Connection lost during update").className,
    ).toContain("sr-only");
    expect(screen.queryByText("Command exited with code 1")).toBeNull();
    expect(
      screen.getByRole("button", {
        name: "Failed · Retry Claude Code on workstation",
      }),
    ).toBeDefined();
    fireEvent.click(
      screen.getByRole("button", { name: "View Claude Code update log" }),
    );
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
      currentCommit: null,
      installKind: "npm" as const,
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
    const copyButton = screen.getByRole("button", {
      name: "Update available · Copy the upgrade command",
    });
    expect(copyButton.textContent).toBe("");
    expect(copyButton.className).not.toContain("bg-secondary");
    const updateSurface = document.querySelector('[data-updates-domain="bb"]');
    expect(updateSurface?.querySelector(".bg-card")).not.toBeNull();
    expect(updateSurface?.querySelector(".divide-y")).not.toBeNull();
    expect(
      within(updateSurface as HTMLElement).getByText("Server"),
    ).toBeDefined();
    expect(screen.queryByText(/^Update available/)).toBeNull();

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
    const installUpdate = vi.fn().mockResolvedValue(undefined);
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: { checkForUpdates, installUpdate } as unknown as BbDesktopApi,
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
    const relaunch = screen.getByRole("button", {
      name: /Relaunch bb to finish updating/,
    });
    expect(relaunch.querySelector("img")?.className).toContain("size-3");
    expect(relaunch.className).toContain("border");
    fireEvent.click(relaunch);
    expect(installUpdate).toHaveBeenCalledOnce();

    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
    });
    expect(sdk.system.version).not.toHaveBeenCalled();
  });

  it("explains an unknown desktop release and retries through the desktop bridge", async () => {
    const desktopInfo: BbDesktopInfo = {
      downloadState: "idle",
      lastCheckedAt: "2026-07-19T00:00:00.000Z",
      latestVersion: null,
      pendingVersion: null,
      platform: "macos",
      updateAvailable: false,
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
    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
      expect(
        (
          screen.getByRole("button", {
            name: /Retry the desktop release check/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
    expect(
      screen.getByText("Couldn't determine the latest desktop release."),
    ).toBeTruthy();

    let finishCheck: (() => void) | undefined;
    checkForUpdates.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCheck = resolve;
        }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Retry the desktop release check/ }),
    );
    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(2);
      expect(
        (
          screen.getByRole("button", {
            name: /Retry the desktop release check/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });
    expect(
      screen.getByText("Checking for a newer desktop release…"),
    ).toBeTruthy();
    await act(async () => finishCheck?.());
    await waitFor(() => {
      expect(
        (
          screen.getByRole("button", {
            name: /Retry the desktop release check/,
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
    });
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

    expect(screen.getByText("Update available")).toBeDefined();
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
    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Failed · Retry the download" }),
    );

    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledTimes(2);
    });
  });

  it("runs every actionable provider update across machines from Update all", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    const laptop = makeHost({ id: "host_1", name: "laptop" });
    const homelab = makeHost({ id: "host_2", name: "homelab" });
    const laptopIssue = makeUpdateIssue({ provider: "codex" });
    const homelabIssue = makeUpdateIssue({ provider: "claude-code" });
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
    expect(screen.getByRole("button", { name: "laptop" })).toBeDefined();
    expect(screen.getByRole("button", { name: "homelab" })).toBeDefined();
    const updateAll = screen.getByRole("button", {
      name: "Update all 2 CLI tools",
    });
    expect(updateAll.textContent).toBe("Update all");
    expect(updateAll.firstElementChild?.getAttribute("data-icon")).toBe(
      "Download",
    );

    fireEvent.click(updateAll);
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
    const issue = makeManualUpdateIssue({ provider: "claude-code" });
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        machines: [makeMachine({ host, issues: [issue] })],
        actionableCount: 1,
        hasAttention: true,
      }),
    );

    renderSection();

    expect(screen.getByText("1 manual")).toBeDefined();
    expect(
      document
        .querySelector('[data-provider-avatar="claude-code"]')
        ?.hasAttribute("data-provider-manual"),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: /Update all/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "workstation" }));
    expect(
      document.querySelector('[data-provider-row="claude-code"]')?.textContent,
    ).toContain("Update in terminal");
    expect(
      screen.queryByRole("button", { name: "Update workstation" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
  });

  it("omits an empty machine container", async () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    useUpdateInventoryMock.mockReturnValue(makeInventory({ machines: [] }));

    renderSection();

    expect(document.querySelector("[data-updates-machine]")).toBeNull();
    expect(screen.queryByText("No machines yet.")).toBeNull();
    expect(screen.getByText("No machines available.")).toBeDefined();
  });

  it("updates bb from the app when the launcher supports it", async () => {
    useWebApp();
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(makeAppUpdateStatus());
    vi.mocked(sdk.system.applyAppUpdate).mockResolvedValue(
      makeAppUpdateStatus({
        activity: {
          output: [],
          phase: "preparing",
          startedAt: "2026-09-23T00:00:00.000Z",
          step: "Downloading bb-app 0.0.6",
          targetVersion: "0.0.6",
        },
      }),
    );

    renderSection();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Update available · Download the update and restart bb",
      }),
    );

    await waitFor(() => {
      expect(sdk.system.applyAppUpdate).toHaveBeenCalledWith({
        confirmInterruptingThreads: false,
      });
    });
    expect(await screen.findByText("Downloading bb-app 0.0.6")).toBeDefined();
    expect(sdk.system.appUpdate).toHaveBeenCalledWith({ force: true });
  });

  it("asks before an update interrupts running threads", async () => {
    useWebApp();
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      makeAppUpdateStatus({ runningThreadCount: 2 }),
    );
    vi.mocked(sdk.system.applyAppUpdate).mockResolvedValue(
      makeAppUpdateStatus(),
    );

    renderSection();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Update available · Download the update and restart bb",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2 threads are running/)).toBeDefined();
    expect(sdk.system.applyAppUpdate).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Update and restart" }),
    );

    await waitFor(() => {
      expect(sdk.system.applyAppUpdate).toHaveBeenCalledWith({
        confirmInterruptingThreads: true,
      });
    });
  });

  it("asks for confirmation when threads started after the status was fetched", async () => {
    useWebApp();
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(makeAppUpdateStatus());
    vi.mocked(sdk.system.applyAppUpdate)
      .mockRejectedValueOnce(
        new BbHttpError({
          body: {
            code: "threads_running",
            details: { runningThreadCount: 1 },
            message: "1 thread is running.",
          },
          code: "threads_running",
          message: "1 thread is running.",
          status: 409,
        }),
      )
      .mockResolvedValueOnce(makeAppUpdateStatus());

    renderSection();
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Update available · Download the update and restart bb",
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 thread is running/)).toBeDefined();
    expect(appToast.error).not.toHaveBeenCalled();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Update and restart" }),
    );
    await waitFor(() => {
      expect(sdk.system.applyAppUpdate).toHaveBeenLastCalledWith({
        confirmInterruptingThreads: true,
      });
    });
  });

  it("retries an unavailable release check from the app row", async () => {
    useWebApp();
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      makeAppUpdateStatus({
        available: null,
        blocked: {
          reason: "fetch-failed",
          message: "Couldn't check npm for a newer release.",
        },
      }),
    );
    useUpdateInventoryMock.mockReturnValue(
      makeInventory({
        systemVersion: {
          currentVersion: "0.0.5",
          currentCommit: null,
          installKind: "npm",
          source: "npm",
          latestVersion: null,
          updateAvailable: false,
          isDevelopment: false,
          upgradeCommand: "npx bb-app@latest",
        },
      }),
    );
    renderSection();
    const retry = await screen.findByRole("button", {
      name: "Latest unknown · Retry the release check",
    });
    expect(
      screen.getByText("Couldn't check npm for a newer release."),
    ).toBeDefined();
    expect(retry.querySelector('[data-icon="CircleQuestion"]')).toBeNull();
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", {
            name: "Latest unknown · Retry the release check",
          })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    vi.mocked(sdk.system.version).mockClear();
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      makeAppUpdateStatus({ available: null, blocked: null }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Latest unknown · Retry the release check",
      }),
    );
    await waitFor(() =>
      expect(sdk.system.version).toHaveBeenCalledWith({ force: true }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("button", {
          name: "Latest unknown · Retry the release check",
        }),
      ).toBeNull(),
    );
  });

  it("shows why a source checkout could not check for updates", async () => {
    useWebApp();
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      makeAppUpdateStatus({
        available: null,
        blocked: {
          message:
            "Could not fetch origin/main: Permission denied (publickey).",
          reason: "fetch-failed",
        },
        current: { commit: "a".repeat(40), version: "0.0.5" },
        support: { kind: "supported", mode: "source" },
      }),
    );

    renderSection();

    expect(
      await screen.findByText(
        "Could not fetch origin/main: Permission denied (publickey).",
      ),
    ).toBeDefined();
  });

  it("keeps a failed update on the row with its details and a retry", async () => {
    useWebApp();
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      makeAppUpdateStatus({
        lastResult: {
          acknowledged: false,
          finishedAt: "2026-09-23T00:00:00.000Z",
          from: { commit: null, version: "0.0.5" },
          id: "update-1",
          logTail: ["npm error code E404"],
          message: "npm install failed",
          outcome: "failed",
          phase: "install",
          to: { commit: null, version: "0.0.6" },
        },
      }),
    );

    renderSection();

    expect(await screen.findByText("Last update failed")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "View the failed bb update" }),
    ).toBeDefined();
    expect(
      screen.getByRole("button", {
        name: "Failed · Download the update and restart bb",
      }),
    ).toBeDefined();
  });

  it("marks a failed update once when no retry is available", async () => {
    useWebApp();
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      makeAppUpdateStatus({
        available: null,
        lastResult: {
          acknowledged: false,
          finishedAt: "2026-09-23T00:00:00.000Z",
          from: { commit: null, version: "0.0.5" },
          id: "update-1",
          logTail: ["npm error code E404"],
          message: "npm install failed",
          outcome: "failed",
          phase: "install",
          to: { commit: null, version: "0.0.6" },
        },
      }),
    );

    renderSection();

    expect(
      await screen.findByRole("button", { name: "View the failed bb update" }),
    ).toBeDefined();
    expect(document.querySelector('[data-update-state="failed"]')).toBeNull();
  });

  it.each([
    {
      installKind: "source" as const,
      currentCommit: "a".repeat(40),
      latestVersion: "9.9.9",
      updateAvailable: true,
    },
    {
      installKind: "source" as const,
      currentCommit: null,
      latestVersion: null,
      updateAvailable: false,
    },
    {
      installKind: "npm" as const,
      currentCommit: null,
      latestVersion: null,
      updateAvailable: false,
    },
  ])(
    "does not claim freshness without a relevant check: %j",
    async (version) => {
      useWebApp();
      useUpdateInventoryMock.mockReturnValue(
        makeInventory({
          machines: [
            {
              ...makeMachine({
                host: makeHost({ id: "host_primary", name: "workstation" }),
                isPrimary: true,
              }),
              providerStatus: null,
            },
          ],
          systemVersion: {
            currentVersion: "0.0.5",
            source: "npm",
            isDevelopment: false,
            upgradeCommand: "npx bb-app@latest",
            ...version,
          },
        }),
      );

      renderSection();

      await screen.findByText("Server");
      expect(screen.queryByText("Latest unknown")).toBeNull();
      expect(document.querySelector('[data-icon="CircleQuestion"]')).toBeNull();
      expect(screen.queryByText("Up to date")).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "Update available · Copy the upgrade command",
        }),
      ).toBeNull();
      if (version.installKind === "npm") {
        expect(
          await screen.findByText("Couldn't check npm for a newer release."),
        ).toBeDefined();
      }
      if (version.installKind === "source") {
        expect(
          screen.queryByText(
            "Update this checkout with Git. Automatic update checks are off.",
          ),
        ).toBeNull();
        expect(screen.getByText("Source checkout")).toBeDefined();
        expect(
          screen.getByText(
            version.currentCommit === null ? "Build 0.0.5" : "aaaaaaa",
          ),
        ).toBeDefined();
        expect(screen.queryByText(/9.9.9/)).toBeNull();
      }
    },
  );

  it.each([true, false])(
    "explains why a source checkout cannot update without an action (incoming: %s)",
    async (incoming) => {
      useWebApp();
      useUpdateInventoryMock.mockReturnValue(
        makeInventory({
          systemVersion: {
            currentVersion: "0.0.5",
            latestVersion: null,
            source: "npm",
            currentCommit: null,
            installKind: "source",
            updateAvailable: false,
            isDevelopment: false,
            upgradeCommand: "npx bb-app@latest",
          },
        }),
      );
      vi.mocked(sdk.system.appUpdate).mockResolvedValue(
        makeAppUpdateStatus({
          available: incoming
            ? {
                channel: "main",
                commit: "b".repeat(40),
                commitCount: 3,
                subjects: ["Fix bug"],
                version: "0.0.5",
              }
            : null,
          blocked: {
            message:
              "The checkout is on feature. Only main can be updated from the app.",
            reason: "not-on-main",
          },
          current: { commit: "a".repeat(40), version: "0.0.5" },
          support: { kind: "supported", mode: "source" },
        }),
      );

      renderSection();

      expect(
        await screen.findByText(
          "The checkout is on feature. Only main can be updated from the app.",
        ),
      ).toBeDefined();
      if (incoming)
        expect(screen.getByText("bbbbbbb (+3 commits)")).toBeDefined();
      else expect(screen.queryByText("bbbbbbb (+3 commits)")).toBeNull();
      expect(document.querySelector('[data-icon="Terminal"]')).toBeNull();
      expect(
        document.querySelector('[data-update-state="update-available"]'),
      ).toBeNull();
      expect(screen.getByText("Source checkout")).toBeDefined();
      expect(
        screen.queryByRole("button", {
          name: "Update available · Download the update and restart bb",
        }),
      ).toBeNull();
    },
  );

  function useDesktopApp(): { checkForUpdates: ReturnType<typeof vi.fn> } {
    const desktopInfo: BbDesktopInfo = {
      downloadState: "idle",
      lastCheckedAt: null,
      latestVersion: "0.0.5",
      pendingVersion: null,
      platform: "macos",
      updateAvailable: false,
      updateDownloaded: false,
      version: "0.0.5",
    };
    const checkForUpdates = vi.fn().mockResolvedValue(desktopInfo);
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: {
        checkForUpdates,
        installUpdate: vi.fn(),
      } as unknown as BbDesktopApi,
      desktopInfo,
      isDesktop: true,
    });
    return { checkForUpdates };
  }

  function desktopFleet(): UpdateInventory {
    return makeInventory({
      machines: [
        makeMachine({
          host: makeHost({ id: "host_primary", name: "bee" }),
          isPrimary: true,
        }),
        makeMachine({ host: makeHost({ id: "host_laptop", name: "laptop" }) }),
      ],
    });
  }

  it("updates a server the desktop does not own from its own Server row", async () => {
    const { checkForUpdates } = useDesktopApp();
    hostDaemon.localDaemonHostId = "host_laptop";
    useUpdateInventoryMock.mockReturnValue(desktopFleet());
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(makeAppUpdateStatus());
    vi.mocked(sdk.system.applyAppUpdate).mockResolvedValue(
      makeAppUpdateStatus(),
    );

    renderSection();

    const bbCard = document.querySelector<HTMLElement>(
      '[data-updates-domain="bb"]',
    );
    if (bbCard === null) throw new Error("expected the bb card");
    fireEvent.click(
      await within(bbCard).findByRole("button", {
        name: "Update available · Download the update and restart bb",
      }),
    );
    expect(within(bbCard).getByText("Server")).toBeDefined();
    expect(within(bbCard).queryByText("Desktop")).toBeNull();
    expect(bbCard.querySelectorAll('[data-bb-update-role="app"]')).toHaveLength(
      1,
    );
    await waitFor(() => {
      expect(sdk.system.applyAppUpdate).toHaveBeenCalledWith({
        confirmInterruptingThreads: false,
      });
    });
    await waitFor(() => {
      expect(checkForUpdates).toHaveBeenCalledOnce();
      expect(sdk.system.appUpdate).toHaveBeenCalledWith({ force: true });
    });
  });

  it("adds a Desktop row under Server only while the desktop needs an update", async () => {
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
    const installUpdate = vi.fn().mockResolvedValue(undefined);
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: {
        checkForUpdates: vi.fn().mockResolvedValue(desktopInfo),
        installUpdate,
      } as unknown as BbDesktopApi,
      desktopInfo,
      isDesktop: true,
    });
    useUpdateInventoryMock.mockReturnValue(desktopFleet());
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(makeAppUpdateStatus());

    renderSection();

    const bbCard = document.querySelector<HTMLElement>(
      '[data-updates-domain="bb"]',
    );
    if (bbCard === null) throw new Error("expected the bb card");
    const desktopName = await within(bbCard).findByText("Desktop");
    const serverName = within(bbCard).getByText("Server");
    expect(
      serverName.compareDocumentPosition(desktopName) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(serverName.className).toBe(desktopName.className);
    expect(serverName.className).toContain("w-16");
    expect(document.querySelector("[data-updates-device]")).toBeNull();
    fireEvent.click(
      within(bbCard).getByRole("button", {
        name: /Relaunch bb to finish updating/,
      }),
    );
    expect(installUpdate).toHaveBeenCalledOnce();
  });

  it("keeps one desktop row when the desktop runs the server itself", async () => {
    useDesktopApp();
    hostDaemon.localDaemonHostId = "host_primary";
    useUpdateInventoryMock.mockReturnValue(desktopFleet());
    vi.mocked(sdk.system.appUpdate).mockResolvedValue(
      makeAppUpdateStatus({
        support: { kind: "unsupported", reason: "desktop" },
      }),
    );

    renderSection();

    await waitFor(() => expect(sdk.system.appUpdate).toHaveBeenCalled());
    expect(screen.getByText("Desktop")).toBeDefined();
    expect(screen.queryByText("Server")).toBeNull();
    expect(
      document.querySelectorAll('[data-bb-update-role="app"]'),
    ).toHaveLength(1);
    expect(
      screen.queryByRole("button", {
        name: "Update available · Download the update and restart bb",
      }),
    ).toBeNull();
  });
});
