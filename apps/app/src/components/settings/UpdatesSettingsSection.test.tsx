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
import type { BbDesktopApi, BbDesktopInfo } from "@bb/desktop-contract";
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

function renderSection({
  showChangelogPreview = false,
}: { showChangelogPreview?: boolean } = {}): void {
  render(
    <MemoryRouter>
      <TooltipProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <UpdatesSettingsSection showChangelogPreview={showChangelogPreview} />
        </QueryClientProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

const useUpdateInventoryMock = vi.mocked(useUpdateInventory);
const useDesktopUpdateInfoMock = vi.mocked(useDesktopUpdateInfo);
const useProviderCliInstallRunnerMock = vi.mocked(useProviderCliInstallRunner);

beforeEach(() => {
  hostDaemon.localDaemonHostId = null;
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

    // Visiting the page is the request to check — there is no button for it.
    expect(screen.queryByRole("button", { name: /check/i })).toBeNull();
    await waitFor(() => {
      expect(sdk.system.version).toHaveBeenCalledWith({ force: true });
    });
    // Exactly one: re-renders must not re-fire it, and the store's own
    // single-flight guard must not be the only thing preventing a loop.
    expect(sdk.system.version).toHaveBeenCalledTimes(1);
  });

  it("aligns Update all with the first machine heading", () => {
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
    expect(updateAll?.lastElementChild?.getAttribute("data-icon")).toBe(
      "Download",
    );
    const workstationHeading = screen.getByRole("heading", {
      name: "workstation",
    });
    const homelabHeading = screen.getByRole("heading", { name: "homelab" });
    const workstationSection = workstationHeading.closest(
      "[data-updates-machine]",
    );
    const homelabSection = homelabHeading.closest("[data-updates-machine]");
    expect(workstationSection?.contains(bulkActions)).toBe(true);
    expect(homelabSection?.contains(bulkActions)).toBe(false);
    expect(bulkActions.querySelector('[data-icon="Download"]')).not.toBeNull();
    expect(bulkActions.parentElement?.className).toContain("pr-4");
  });

  it("keeps the changelog preview behind its experiment", () => {
    useDesktopUpdateInfoMock.mockReturnValue({
      desktopApi: null,
      desktopInfo: null,
      isDesktop: false,
    });
    useUpdateInventoryMock.mockReturnValue(makeInventory({}));

    renderSection();

    expect(
      document.querySelector('[data-updates-domain="changelog"]'),
    ).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a recently checked healthy fleet quiet and accessible", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(`# Changelog

## 9.9.9

The canonical release summary.

### New features

- One current feature.

### Fixes

- One current fix.
`),
        ),
      ),
    );
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

    renderSection({ showChangelogPreview: true });

    // A settled row is a mark, named only to a screen reader and on hover.
    // Opening the page runs the check, so there is no freshness stamp: the age
    // of the claim is always "since you got here".
    await waitFor(() => {
      expect(screen.getByText("Up to date").className).toContain("sr-only");
    });
    expect(screen.queryByText("2 up to date")).toBeNull();
    expect(screen.getByRole("heading", { name: /workstation/ })).toBeDefined();
    expect(screen.queryByText("Primary")).toBeNull();
    expect(screen.queryByText("This machine")).toBeNull();
    expect(screen.queryByText("studio-mac")).toBeNull();
    expect(screen.queryByText(/Checked/)).toBeNull();
    expect(screen.queryByText(/ago$/)).toBeNull();
    expect(screen.queryByText(/^In sync$/)).toBeNull();
    expect(screen.queryByText("workstation, studio-mac")).toBeNull();
    // Opening the page is the request to check, so there is no button to press
    // and no freshness stamp to justify one.
    expect(screen.queryByRole("button", { name: /check/i })).toBeNull();
    // Nothing needs updating, so the page drops the "Updates" title entirely
    // and the settled sentence is the heading.
    expect(screen.queryByRole("heading", { name: "Updates" })).toBeNull();
    // The changelog is a preview card at the top of the page, not a row
    // action: it is about the release, not about any one row. It stays
    // reachable with nothing to install, and every word in it is the
    // changelog's own.
    expect(
      screen.getByRole("button", { name: /^Open the full bb .* changelog$/ }),
    ).toBeDefined();
    const changelog = document.querySelector(
      '[data-updates-domain="changelog"]',
    );
    await waitFor(() => {
      expect(changelog?.textContent).toContain("9.9.9");
    });
    expect(
      within(changelog as HTMLElement).getByRole("heading", {
        level: 2,
        name: "What's new",
      }),
    ).toBeDefined();
    expect(
      within(changelog as HTMLElement).getByRole("heading", {
        level: 3,
        name: "9.9.9",
      }),
    ).toBeDefined();
    expect(changelog?.textContent).toContain("The canonical release summary.");
    expect(
      changelog?.querySelector('[data-changelog-version="9.9.9"]'),
    ).not.toBeNull();
    const changelogLabel = changelog?.querySelector("[data-changelog-label]");
    expect(changelogLabel?.className).toContain("rounded-sm");
    expect(changelogLabel?.className).not.toContain("rounded-full");
    expect(changelogLabel?.className).toContain("bg-muted/40");
    const changelogPreview = changelog?.querySelector(
      "[data-changelog-preview]",
    );
    expect(changelogPreview?.className).toContain("p-4");
    expect(changelogPreview?.className).not.toContain("grid");
    expect(
      changelog?.querySelector("[data-changelog-release-scroll]")?.className,
    ).toContain("max-h-56");
    expect(
      changelog?.querySelector("[data-changelog-footer]")?.className,
    ).toContain("border-t");
    expect(
      changelog?.querySelector("[data-changelog-footer]")?.className,
    ).toContain("bg-foreground");
    expect(
      changelog?.querySelector("[data-changelog-footer]")?.className,
    ).toContain("text-background");
    // The footer is one fixed label, so it cannot change length with whatever
    // release happens to be bundled.
    expect(changelog?.textContent).toContain("Full changelog");
    expect(
      screen.getByRole("button", {
        name: "Open the full bb 9.9.9 changelog",
      }).className,
    ).toContain("font-semibold");
    // The card carries the whole release, not a fixed three: a truncated list
    // reads as the complete set unless the reader already knows to doubt it.
    for (const highlight of ["New features", "Fixes"]) {
      expect(
        within(changelog as HTMLElement).getByRole("heading", {
          level: 4,
          name: highlight,
        }),
      ).toBeDefined();
    }
    expect(changelog?.textContent).toContain("One current feature.");
    expect(changelog?.textContent).toContain("One current fix.");
    const dismissChangelog = screen.getByRole("button", {
      name: "Dismiss bb 9.9.9 changelog preview",
    });
    expect(dismissChangelog.querySelector('[data-icon="X"]')).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Open the full bb 9.9.9 changelog",
      }),
    );
    expect(openUrlInExternalBrowserMock).toHaveBeenCalledWith(
      "https://getbb.app/changelog#9-9-9",
    );
    vi.useFakeTimers();
    fireEvent.click(dismissChangelog);
    expect(screen.getByRole("status").textContent).toContain(
      "You're all caught up",
    );
    expect(
      screen.queryByRole("button", {
        name: "Open the full bb 9.9.9 changelog",
      }),
    ).toBeNull();
    expect(changelog?.getAttribute("data-changelog-dismiss-phase")).toBe(
      "confirming",
    );
    expect(
      changelog?.querySelector("[data-changelog-release-panel]")?.className,
    ).toContain("grid-rows-[0fr]");
    const confirmation = changelog?.querySelector(
      "[data-changelog-dismiss-confirmation]",
    );
    expect(confirmation?.className).toContain("grid-rows-[1fr]");
    expect(confirmation?.className).not.toContain("absolute");
    expect(changelog?.className).toContain("motion-reduce:transition-none");
    expect(
      window.localStorage.getItem(
        "bb.settings.updates.dismissed-changelog-version",
      ),
    ).toBe("9.9.9");

    act(() => vi.advanceTimersByTime(1_999));
    expect(changelog?.getAttribute("data-changelog-dismiss-phase")).toBe(
      "confirming",
    );
    act(() => vi.advanceTimersByTime(1));
    expect(changelog?.getAttribute("data-changelog-dismiss-phase")).toBe(
      "exiting",
    );
    expect(changelog?.className).toContain("grid-rows-[0fr]");
    act(() => vi.advanceTimersByTime(180));
    expect(
      document.querySelector('[data-updates-domain="changelog"]'),
    ).toBeNull();
    vi.useRealTimers();

    cleanup();
    renderSection({ showChangelogPreview: true });
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledTimes(2);
    });
    expect(
      document.querySelector('[data-updates-domain="changelog"]'),
    ).toBeNull();

    cleanup();
    window.localStorage.setItem(
      "bb.settings.updates.dismissed-changelog-version",
      "9.9.8",
    );
    renderSection({ showChangelogPreview: true });
    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Dismiss bb 9.9.9 changelog preview",
        }),
      ).toBeDefined();
    });

    // Being up to date is the state every row is expected to be in, so it
    // carries no indicator: the page spends its dots on exceptions only.
    const settled = screen.getByText(/^Up to date/);
    expect(settled.parentElement?.querySelector(".bg-success")).toBeNull();
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

    expect(screen.getByText("homelab")).toBeDefined();
    expect(screen.queryByText("1 offline")).toBeNull();
    expect(screen.getByText("Offline")).toBeDefined();
    const offlineIcon = document.querySelector(
      '[data-update-state="offline"] [data-icon="CircleX"]',
    );
    expect(offlineIcon?.getAttribute("class")).toContain(
      "text-subtle-foreground",
    );
    expect(offlineIcon?.getAttribute("class")).not.toContain("text-input");
    const daemonRow = screen
      .getByText("bb daemon")
      .closest("[data-resource-row]");
    expect(daemonRow).not.toBeNull();
    expect(screen.getByText("bb app")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Open homelab settings" }),
    ).toBeDefined();
    // App and daemon rows use the bb identity mark; machine ownership comes
    // from the section heading rather than a laptop glyph in the row.
    expect(
      daemonRow?.querySelector('[data-bb-update-role="daemon"]'),
    ).not.toBeNull();
    expect(
      document.querySelector('[data-bb-update-role="app"]'),
    ).not.toBeNull();
    expect(daemonRow?.querySelector('[data-icon="Laptop"]')).toBeNull();
    // An unreachable machine is not pending update work, so the page still
    // leads with the settled answer instead of going silent.
    // Every row states its own condition, and a settled one says when that was
    // established rather than going blank.
    await waitFor(() => {
      expect(screen.getByText(/^Up to date/)).toBeDefined();
    });
    expect(screen.queryByText(/all in sync/)).toBeNull();
  });

  it("shows only machines with relevant health status in a mixed fleet", () => {
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

    expect(document.querySelectorAll("[data-updates-machine]")).toHaveLength(3);
    expect(screen.queryByText("Needs attention")).toBeNull();
    expect(screen.getByText("workstation")).toBeDefined();
    expect(screen.getByText("studio-mac")).toBeDefined();
    expect(screen.getByText("Offline")).toBeDefined();
    expect(screen.getByText("homelab")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /^Failed · Retry on/ }),
    ).toBeDefined();
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

    expect(screen.getByText("homelab")).toBeDefined();
    expect(screen.queryByText("1 updating")).toBeNull();
    // The machine owns the section; the row identifies the daemon explicitly.
    expect(screen.getByText("bb daemon")).toBeDefined();
    expect(screen.getAllByText("In progress").length).toBeGreaterThan(0);
    expect(
      document.querySelector('[data-updates-machine="host_1"]'),
    ).not.toBeNull();
    expect(screen.queryByText("1 machine is updating bb")).toBeNull();
    expect(screen.queryByRole("button", { name: "Retry update" })).toBeNull();
    expect(screen.queryByText(/can't connect/i)).toBeNull();
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
    // Not "stalled": that names an internal step and gives the reader nothing
    // to weigh. How long it has been waiting is what makes it judgeable.
    expect(
      screen.getByRole("button", { name: "Failed · Retry on homelab now" }),
    ).toBeDefined();
    expect(screen.queryByText("1 machine needs attention")).toBeNull();
    expect(screen.queryByText(/daemon protocol/)).toBeNull();
    expect(
      screen.getByText("bb daemon").closest("[data-resource-row]")?.className,
    ).not.toContain("bg-surface-destructive");
    // A stalled bb update is outstanding update work, so the page must not
    // claim everything is settled while that row sits under the claim.
    expect(screen.queryByText(/^Up to date/)).toBeNull();
    const stalledMessage = screen.getByText("Update didn't finish");
    expect(stalledMessage.tagName).toBe("SPAN");
    expect(stalledMessage.className).toContain("font-semibold");
    expect(stalledMessage.className).toContain("text-destructive");
    expect(stalledMessage.className).not.toContain("rounded");
    expect(stalledMessage.className).not.toContain("font-mono");
    // The row states the condition once; no banner repeats it above.
    expect(
      screen.getAllByRole("button", { name: /^Failed · Retry on/ }),
    ).toHaveLength(1);

    // One stuck machine already has its own Retry on the row, so a bulk sweep
    // beside it would be two controls doing the same thing.
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
              // Ahead of the server, so the machine cannot fix itself and no
              // retry can help — the server is what has to move.
              lastRejectedProtocolVersion: HOST_DAEMON_PROTOCOL_VERSION + 1,
            }),
            canRetryDaemonUpdate: false,
          }),
        ],
      }),
    );

    renderSection();

    // "Offline" alone was true here and useless: it sends the reader to check
    // a network that is working perfectly. The mark still says offline — that
    // is the condition — but the row now names the fix beside the machine.
    expect(screen.getByText("Update this app to reconnect")).toBeDefined();
    // Nothing on this machine can resolve it, so the row offers no action.
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
    // A server protocol bump rejects every enrolled daemon at once, so a
    // broken rollout stalls the whole fleet rather than one machine.
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
    // Each row keeps its own Retry: the sweep is an addition, not a takeover.
    expect(
      screen.getByRole("button", {
        name: "Failed · Retry on studio-mac now",
      }),
    ).toBeDefined();
  });

  it("shows only provider CLIs that need attention", () => {
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

    const machineHeading = screen.getByRole("heading", {
      name: /workstation/,
    });
    const machineSection = machineHeading.closest("section");
    expect(machineSection).not.toBeNull();
    // Settings chrome: the same caption weight every other settings section
    // uses, so Updates does not read as a differently-built page.
    expect(machineHeading.className).toContain("font-semibold");
    expect(machineHeading.className).toContain("text-foreground");
    const machineName = screen.getByText("workstation");
    expect(machineHeading.querySelector('[data-icon="Laptop"]')).not.toBeNull();
    expect(machineName.nextElementSibling).toBeNull();
    // No summary banner above the rows: with work outstanding the rows are
    // the statement, and with none the settled card is the only thing shown.
    expect(screen.getByText("bb app")).toBeDefined();
    expect(screen.queryByLabelText(/available update/)).toBeNull();
    expect(screen.getAllByText("workstation")).toHaveLength(1);
    expect(screen.getByText("Codex")).toBeDefined();
    expect(screen.queryByText("Claude Code")).toBeNull();
    expect(screen.queryByText(/^Update available/)).toBeNull();
    expect(screen.queryByText("Choose an update below.")).toBeNull();
    const providerIcon = document.querySelector('[data-provider-icon="codex"]');
    expect(providerIcon).not.toBeNull();
    expect(providerIcon?.querySelector("svg")?.className.baseVal).toContain(
      "text-muted-foreground",
    );
    // Icon-only. The accessible name is the state and the verb — the row
    // already prints the CLI, its versions, and the machine above it. Row and
    // bulk actions share the same quiet treatment so neither competes with the
    // update inventory itself.
    const updateButton = screen.getAllByRole("button", {
      name: "Update available · Update Codex on workstation",
    })[0];
    expect(updateButton.textContent).toBe("");
    // Drawn by the shared `ResourceActionButton`, so it carries that atom's
    // muted treatment rather than a colour this page picked for itself.
    expect(updateButton.className).toContain("text-muted-foreground");
    expect(updateButton.className).not.toContain("bg-secondary");
    expect(updateButton.className).not.toContain("bg-foreground");
    // Versions sit inline after the name rather than flushed to the right
    // edge, and only the version you'd move to is recoloured and weighted.
    const versionMetadata = machineSection
      ?.querySelector('[data-provider-icon="codex"]')
      ?.closest("[data-resource-row]")
      ?.querySelector("[data-version-metadata]");
    expect(versionMetadata?.className).toContain("text-2xs");
    expect(versionMetadata?.className).not.toContain("text-right");
    expect(versionMetadata?.className).not.toContain("ml-auto");
    // Not `font-mono`: that stack resolves to one face, so the target
    // version's heavier weight rendered identically to the version you are on.
    expect(versionMetadata?.className).not.toContain("font-mono");
    const upgrade = versionMetadata?.querySelector(".text-version-upgrade");
    expect(upgrade?.textContent).toBe("1.0.1");
    expect(upgrade?.className).toContain("font-semibold");
    expect(screen.queryByText("1 up to date")).toBeNull();
  });

  it("badges the client-local daemon independently from the primary update owner", () => {
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

    const primaryHeading = screen.getByRole("heading", {
      name: /workstation/u,
    });
    const localHeading = screen.getByRole("heading", { name: /studio-mac/u });
    expect(primaryHeading.textContent).not.toContain("Primary");
    expect(primaryHeading.textContent).not.toContain("This machine");
    expect(localHeading.textContent).toContain("This machine");
    expect(localHeading.textContent).not.toContain("Primary");
  });

  it("lists Cursor updates with the other provider CLIs", () => {
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
      screen.getByRole("button", { name: "Open Cursor settings" }),
    ).toBeDefined();
    expect(
      document.querySelector('[data-provider-icon="acp-cursor"]'),
    ).not.toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: "Update available · Update Cursor on workstation",
      }),
    );
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host_1",
      issue: cursorIssue,
    });
  });

  it("names a machine once above all of its CLI updates", () => {
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

    // The machine heads the group; its rows name only the tool. Repeating the
    // hostname on every row was the redundancy this grouping removes.
    expect(screen.getAllByText("workstation")).toHaveLength(1);
    expect(screen.getByText("Codex")).toBeDefined();
    expect(screen.getByText("Claude Code")).toBeDefined();
    // Versions stay per row: the same CLI is routinely a different version on
    // each host, which is why the rows cannot collapse to one per provider.
    expect(
      document
        .querySelector('[data-updates-machine="host_1"]')
        ?.querySelectorAll("[data-resource-row] [data-version-metadata]")
        .length,
    ).toBe(2);
    // Each row still drives its own host-scoped install.
    fireEvent.click(
      screen.getAllByRole("button", {
        name: /^Update available · Update/,
      })[0],
    );
    expect(startInstallMock).toHaveBeenCalledTimes(1);
    expect(startInstallMock.mock.calls[0]?.[0]).toMatchObject({
      hostId: "host_1",
    });
  });

  it("keeps background provider checks out of the compact view", async () => {
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

    // Every row states its own condition, and a settled one says when that was
    // established rather than going blank.
    await waitFor(() => {
      expect(screen.getByText(/^Up to date/)).toBeDefined();
    });
    expect(screen.queryByText("1 up to date")).toBeNull();
    expect(screen.getByRole("heading", { name: "workstation" })).toBeDefined();
    expect(screen.queryByText("Checking provider CLIs…")).toBeNull();
  });

  it("offers a way out of a failed CLI check", async () => {
    // The status query is session-static (staleTime Infinity, no refetch on
    // mount/focus/reconnect), so an errored row used to be permanent for the
    // life of the page: it named a problem with no affordance to clear it.
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

    await waitFor(() => {
      expect(screen.getByText("Couldn't check for updates")).toBeDefined();
    });
    const retry = screen.getByRole("button", {
      name: /Check workstation's CLIs again/,
    });
    expect(retry.hasAttribute("disabled")).toBe(false);
  });

  it("keeps error red on the reason and off the recovery", () => {
    // One rule for the whole page: red states what is wrong, never what fixes
    // it. A destructive-tinted Retry reads as a second failure rather than a
    // way out, and it drifted before because three branches each decided tone
    // for themselves.
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

    const failedStatus = screen.getByText("Couldn't check for updates");
    expect(failedStatus.tagName).toBe("SPAN");
    for (const className of [
      "shrink-0",
      "text-xs",
      "font-semibold",
      "text-destructive",
    ]) {
      expect(failedStatus.className).toContain(className);
    }
    for (const className of [
      "rounded",
      "border",
      "px-",
      "py-",
      "bg-",
      "font-mono",
    ]) {
      expect(failedStatus.className).not.toContain(className);
    }
    expect(
      screen.getByRole("button", { name: /Check workstation's CLIs again/ })
        .className,
    ).not.toContain("text-destructive");
  });

  it("leaves never-installed CLIs off an update page", () => {
    // An update page lists things that have an update. A CLI you never
    // installed has no version to be behind, so it is a first-install decision
    // and belongs on Providers — it used to sit here permanently with a
    // Download control and count toward "Update all".
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

    expect(screen.getByText("Claude Code")).toBeDefined();
    expect(screen.queryByText("Codex")).toBeNull();
  });

  it("removes running and queued provider jobs from Update all", () => {
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
    expect(screen.queryByText("2 updates in progress")).toBeNull();
    // Running and queued are the same spinner: one is not a state the reader
    // can act on differently from the other.
    expect(
      document.querySelectorAll(
        '[data-updates-machine="host_1"] [data-resource-row] [data-update-state="in-progress"]',
      ).length,
    ).toBe(2);
    for (const providerId of ["codex", "claude-code"]) {
      expect(
        document
          .querySelector(`[data-provider-icon="${providerId}"] svg`)
          ?.getAttribute("class"),
      ).toContain("text-muted-foreground");
    }
  });

  it("keeps a provider update failure and its command log on the row", () => {
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
    // Icon-only row action: the accessible name carries what the label used to.
    const copyButton = screen.getByRole("button", {
      name: "Update available · Copy the upgrade command",
    });
    expect(copyButton.textContent).toBe("");
    // Row actions are plain regardless of domain.
    expect(copyButton.className).not.toContain("bg-secondary");
    const updateSurface = document.querySelector(
      '[data-updates-machine="host_primary"]',
    );
    // The house settings card, with its rows on the house divider — the same
    // chrome every other section of Settings is drawn in.
    expect(updateSurface?.querySelector(".bg-card")).not.toBeNull();
    expect(updateSurface?.querySelector(".divide-y")).not.toBeNull();
    expect(screen.queryByText(/^Update available/)).toBeNull();

    // Opening the page is the check. Nothing to click, and the forced refresh
    // still bypasses the cached version.
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

    // On a desktop shell the load-time check goes through the bridge, not the
    // server's version endpoint.
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
    // The page already checked once on load; Retry is a second, explicit run.
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
    expect(screen.getByRole("heading", { name: "laptop" })).toBeDefined();
    expect(screen.getByRole("heading", { name: "homelab" })).toBeDefined();
    // The count stays in the accessible name while the visible control uses
    // the established update glyph and the concise requested label.
    const updateAll = screen.getByRole("button", {
      name: "Update all 2 CLI tools",
    });
    expect(updateAll.textContent).toBe("Update all");
    expect(updateAll.querySelector('[data-icon="Download"]')).not.toBeNull();

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

    // Where to do it, not the category: bb has no installer it can drive for
    // this install, so the next step is a terminal.
    expect(screen.getAllByText("Update in terminal").length).toBeGreaterThan(0);
    expect(screen.queryByText("1 update needs manual action")).toBeNull();
    expect(screen.queryByRole("button", { name: "Update" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Update all/ })).toBeNull();
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
});
