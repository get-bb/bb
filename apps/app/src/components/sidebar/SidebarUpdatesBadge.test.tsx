// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import type { Host } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import type {
  ProviderCliInstallAction,
  ProviderCliKey,
} from "@bb/host-daemon-contract";
import type {
  PluginUpdateJob,
  SystemAppUpdateStatus,
} from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProviderCliIssue } from "@/components/provider-cli/provider-cli-install";
import type { ProviderCliInstallFailure } from "@/components/provider-cli/provider-cli-install-store";
import type {
  UpdateInventory,
  UpdateInventoryMachine,
} from "@/hooks/useUpdateInventory";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makePluginListItem } from "@/test/fixtures/plugins";
import { SidebarProvider } from "@/components/ui/sidebar";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";

const live = vi.hoisted(() => ({
  listeners: new Set<() => void>(),
  inventory: null as UpdateInventory | null,
  providerJobs: {
    runningJobKey: null as string | null,
    queuedJobKeys: new Set<string>(),
    failuresByJobKey: new Map<string, unknown>(),
  },
  pluginJobs: [] as PluginUpdateJob[],
}));
const preferences = vi.hoisted(() => ({ showProviderCliUpdates: true }));
const startInstallMock = vi.hoisted(() => vi.fn());
const appUpdateState = vi.hoisted(() => ({
  status: undefined as SystemAppUpdateStatus | undefined,
}));
const applyAppUpdateMock = vi.hoisted(() => vi.fn());
const startPluginUpdateMock = vi.hoisted(() => vi.fn());
const desktopState = vi.hoisted(() => ({
  installUpdate: vi.fn(async () => {}),
  isDesktop: false,
}));

type LiveUpdates = Pick<
  typeof live,
  "inventory" | "providerJobs" | "pluginJobs"
>;

function subscribeToLive(listener: () => void) {
  live.listeners.add(listener);
  return () => {
    live.listeners.delete(listener);
  };
}

function setLive(change: Partial<LiveUpdates>) {
  act(() => {
    Object.assign(live, change);
    for (const listener of live.listeners) listener();
  });
}

vi.mock("@/hooks/useUpdateInventory", () => ({
  useUpdateInventory: () =>
    useSyncExternalStore(subscribeToLive, () => live.inventory),
}));

vi.mock("@/components/provider-cli/provider-cli-install", async (original) => ({
  ...(await original<
    typeof import("@/components/provider-cli/provider-cli-install")
  >()),
  useProviderCliInstallRunner: () => ({
    ...useSyncExternalStore(subscribeToLive, () => live.providerJobs),
    startInstall: startInstallMock,
  }),
}));

vi.mock("@/hooks/queries/app-update-queries", () => ({
  useAppUpdateStatus: () => ({ data: appUpdateState.status }),
}));

vi.mock("@/hooks/mutations/app-update-mutations", () => ({
  useApplyAppUpdate: () => ({ mutate: applyAppUpdateMock, isPending: false }),
}));

vi.mock("@/hooks/queries/plugin-update-job-queries", () => ({
  usePluginUpdateJobs: () => ({
    data: useSyncExternalStore(subscribeToLive, () => live.pluginJobs),
  }),
  startPluginUpdate: startPluginUpdateMock,
}));

vi.mock("@/hooks/cache-owners/plugin-cache-owner", () => ({
  applyPluginUpdateJob: vi.fn(),
}));

vi.mock("@/hooks/useDesktopUpdateInfo", () => ({
  useDesktopUpdateInfo: () =>
    desktopState.isDesktop
      ? {
          desktopApi: { installUpdate: desktopState.installUpdate },
          desktopInfo: null,
          isDesktop: true,
        }
      : { desktopApi: null, desktopInfo: null, isDesktop: false },
}));

vi.mock("@/hooks/queries/system-queries", async (original) => ({
  ...(await original<typeof import("@/hooks/queries/system-queries")>()),
  useSystemConfig: () => ({
    data: {
      generalSettings: { resumeThreadsAfterRestart: true },
    },
  }),
}));

vi.mock("@/lib/sdk", async () => {
  const { makeProviderInfo: provider } =
    await import("@bb/test-helpers/domain-fixtures");
  return {
    sdk: {
      providers: {
        list: vi.fn(async () => [
          provider({ id: "claude-code", displayName: "Claude Code" }),
          provider({ id: "codex", displayName: "Codex" }),
        ]),
      },
    },
  };
});

vi.mock("./sidebar-update-preferences", async () => {
  const { atom } = await import("jotai");
  return {
    showProviderCliUpdatesAtom: atom(() => preferences.showProviderCliUpdates),
    skippedSidebarUpdatesAtom: atom<string[]>([]),
  };
});

vi.mock("@/lib/ws", () => ({
  wsManager: { subscribe: vi.fn(), unsubscribe: vi.fn() },
}));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  live.inventory = null;
  live.providerJobs = {
    runningJobKey: null,
    queuedJobKeys: new Set(),
    failuresByJobKey: new Map(),
  };
  live.pluginJobs = [];
  startInstallMock.mockReset();
  appUpdateState.status = undefined;
  applyAppUpdateMock.mockReset();
  startPluginUpdateMock.mockReset();
  desktopState.isDesktop = false;
  desktopState.installUpdate.mockClear();
  preferences.showProviderCliUpdates = true;
});

const UPDATE_ACTION: ProviderCliInstallAction = {
  kind: "update",
  label: "Update",
  command: "npm install -g example",
};

function providerIssue(
  provider: ProviderCliKey,
  displayName: string,
  action: ProviderCliInstallAction | null = UPDATE_ACTION,
): ProviderCliIssue {
  return {
    provider,
    status: {
      displayName,
      executableName: provider,
      executablePath: `/usr/local/bin/${provider}`,
      installed: true,
      installSource: "npmGlobal",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      minimumSupportedVersion: "1.0.0",
      npmPackageName: `@example/${provider}`,
      npmGlobalPackageVersion: "1.0.0",
      installAction: action,
      needsUpdate: true,
      versionUnsupported: false,
    },
    action,
    title: `${displayName} update available`,
    description: "1.0.0 -> 1.1.0",
    fingerprint: `${provider}:outdated`,
  };
}

function missingInstallIssue(
  provider: ProviderCliKey,
  displayName: string,
): ProviderCliIssue {
  return {
    provider,
    status: {
      displayName,
      executableName: provider,
      executablePath: null,
      installed: false,
      installSource: "notInstalled",
      currentVersion: null,
      latestVersion: "1.1.0",
      minimumSupportedVersion: null,
      npmPackageName: `@example/${provider}`,
      npmGlobalPackageVersion: null,
      installAction: null,
      needsUpdate: false,
      versionUnsupported: false,
    },
    action: null,
    title: `${displayName} CLI not installed`,
    description: `Install ${displayName} so bb can start ${displayName} sessions.`,
    fingerprint: `${provider}:missing:1.1.0`,
  };
}

function host(id: string): Host {
  return makeHost({ id, name: id });
}

function machine(
  overrides: Partial<UpdateInventoryMachine>,
): UpdateInventoryMachine {
  return {
    host: host("host-1"),
    isPrimary: true,
    providerStatus: null,
    statusPending: false,
    statusFetching: false,
    statusError: false,
    issues: [],
    canRetryDaemonUpdate: false,
    ...overrides,
  };
}

function plugin(id: string) {
  return makePluginListItem({
    id,
    name: id,
    version: "1.0.0",
    source: `npm:@acme/${id}@^1.0.0`,
  });
}

function appUpdateStatus(
  overrides: Partial<SystemAppUpdateStatus> = {},
): SystemAppUpdateStatus {
  return {
    activity: { phase: "idle" },
    available: {
      behindSince: null,
      channel: "latest",
      commit: null,
      commitCount: null,
      subjects: [],
      version: "0.49.0",
    },
    blocked: null,
    current: { commit: null, version: "0.48.2" },
    lastResult: null,
    autoUpdate: true,
    availableSkipped: false,
    runningThreadCount: 0,
    scheduled: null,
    support: { kind: "supported", mode: "npm" },
    ...overrides,
  };
}

const NO_PLUGIN_UPDATES: UpdateInventory["plugins"] = {
  trackedCount: 0,
  items: [],
};

function inventory(overrides: Partial<UpdateInventory>): UpdateInventory {
  return {
    isLoading: false,
    systemVersion: undefined,
    desktopInfo: null,
    appUpdateAvailable: false,
    desktopUpdateReady: false,
    machines: [],
    plugins: NO_PLUGIN_UPDATES,
    pluginAttentionCount: 0,
    actionableCount: 0,
    hasAttention: false,
    lastCheckedAt: null,
    ...overrides,
  };
}

function renderBadge(overrides: Partial<UpdateInventory>) {
  live.inventory = inventory(overrides);
  const { wrapper } = createQueryClientTestHarness();
  return render(<BadgeHarness />, { wrapper });
}

function BadgeHarness() {
  return (
    <MemoryRouter>
      <TooltipProvider>
        <SidebarProvider>
          <SidebarUpdatesBadge />
        </SidebarProvider>
      </TooltipProvider>
    </MemoryRouter>
  );
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

function updateButton(): HTMLElement {
  return screen.getByTestId("sidebar-update-button");
}

async function openCard(): Promise<HTMLElement> {
  fireEvent.focus(updateButton());
  return await screen.findByTestId("sidebar-update-card");
}

function rowStates(card: HTMLElement): Array<[string, string | null]> {
  return [...card.querySelectorAll("[data-update-row]")].map((row) => [
    row.textContent ?? "",
    row.getAttribute("data-state"),
  ]);
}

describe("SidebarUpdatesBadge", () => {
  it("renders nothing when no update needs attention", () => {
    renderBadge({});
    expect(screen.queryByTestId("sidebar-update-button")).toBeNull();
    expect(screen.queryByTestId("sidebar-machines-attention-badge")).toBeNull();
  });

  it("draws every kind of update as one button that opens Settings › Updates", () => {
    appUpdateState.status = appUpdateStatus();
    renderBadge({
      appUpdateAvailable: true,
      machines: [machine({ issues: [providerIssue("codex", "Codex")] })],
      plugins: {
        trackedCount: 1,
        items: [{ kind: "update", plugin: plugin("linear"), version: "1.2.0" }],
      },
    });

    expect(screen.getAllByRole("link")).toHaveLength(1);
    const button = screen.getByRole("link", { name: "3 updates available" });
    expect(button.getAttribute("href")).toBe("/settings/updates");
    expect(button.querySelector('[data-icon="Download"]')).toBeTruthy();
  });

  it("lists bb, then provider CLIs and plugins, leaving out blocked plugins", async () => {
    appUpdateState.status = appUpdateStatus();
    renderBadge({
      appUpdateAvailable: true,
      machines: [machine({ issues: [providerIssue("codex", "Codex")] })],
      plugins: {
        trackedCount: 2,
        items: [
          { kind: "update", plugin: plugin("linear"), version: "1.2.0" },
          {
            kind: "blocked",
            plugin: plugin("legacy"),
            version: "2.0.0",
            reasons: ["engines.bb requires >=9.0.0"],
          },
        ],
      },
    });

    const card = await openCard();
    const bb = within(card).getByRole("region", { name: "bb update" });
    expect(bb.textContent).toContain("bb 0.49.0");
    expect(bb.textContent).toContain("from 0.48.2");
    expect(bb.textContent).toContain("Installs itself when you're idle");
    expect(rowStates(card)).toEqual([
      ["Codex1.0.0 → 1.1.0", "available"],
      ["linear1.0.0 → 1.2.0", "available"],
    ]);
    expect(
      within(card).getByRole("button", { name: "Update 2 CLIs and plugins" }),
    ).toBeTruthy();
    expect(
      within(card).getByRole("link", { name: "Details" }).getAttribute("href"),
    ).toBe("/settings/updates");
  });

  it("lists a source update that is not badge-worthy yet once other updates open the card", async () => {
    appUpdateState.status = appUpdateStatus({
      available: {
        behindSince: new Date().toISOString(),
        channel: "main",
        commit: "5c1cf4ef2d605962df3d60a35a4d01b5212d59cc",
        commitCount: 9,
        subjects: [],
        version: "0.49.0",
      },
      current: {
        commit: "1320c88e8abdd3f145bc9a5c305eace269fb2f28",
        version: "0.49.0",
      },
      support: { kind: "supported", mode: "source" },
    });
    const view = renderBadge({ appUpdateAvailable: false });
    expect(screen.queryByTestId("sidebar-update-button")).toBeNull();
    view.unmount();

    renderBadge({
      appUpdateAvailable: false,
      machines: [machine({ issues: [providerIssue("codex", "Codex")] })],
    });
    const card = await openCard();
    const bb = within(card).getByRole("region", { name: "bb update" });
    expect(bb.textContent).toContain("bb 5c1cf4e");
    expect(bb.textContent).toContain("from 1320c88");
    expect(rowStates(card)).toEqual([["Codex1.0.0 → 1.1.0", "available"]]);
  });

  it("says bb waits for a restart when it does not update itself", async () => {
    appUpdateState.status = appUpdateStatus({ autoUpdate: false });
    renderBadge({ appUpdateAvailable: true });

    const card = await openCard();
    expect(card.textContent).toContain("Installs when bb restarts");
    expect(within(card).queryByRole("button", { name: /^Update / })).toBe(null);
    expect(updateButton().getAttribute("aria-label")).toBe(
      "1 update available",
    );
  });

  it("restarts bb into the update from the card, asking first when threads run", async () => {
    appUpdateState.status = appUpdateStatus({ runningThreadCount: 2 });
    renderBadge({ appUpdateAvailable: true });

    const card = await openCard();
    fireEvent.click(
      within(card).getByRole("button", { name: "Restart into bb 0.49.0 now" }),
    );
    expect(applyAppUpdateMock).not.toHaveBeenCalled();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toContain("2 threads are running.");
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Update and restart" }),
    );
    expect(applyAppUpdateMock).toHaveBeenCalledWith(
      { confirmInterruptingThreads: true },
      expect.anything(),
    );
  });

  it("relaunches a downloaded desktop update", async () => {
    desktopState.isDesktop = true;
    renderBadge({ desktopUpdateReady: true });

    const card = await openCard();
    fireEvent.click(
      within(card).getByRole("button", { name: /^Restart .* now$/ }),
    );
    expect(desktopState.installUpdate).toHaveBeenCalledTimes(1);
    expect(applyAppUpdateMock).not.toHaveBeenCalled();
  });

  it("updates every provider CLI and plugin that can start, without touching bb", async () => {
    appUpdateState.status = appUpdateStatus();
    const codex = providerIssue("codex", "Codex");
    const manual = providerIssue("claude-code", "Claude Code", null);
    startPluginUpdateMock.mockResolvedValue({
      id: "job-1",
      pluginId: "linear",
      displayName: "linear",
      state: "queued",
    });
    renderBadge({
      appUpdateAvailable: true,
      machines: [machine({ issues: [codex, manual] })],
      plugins: {
        trackedCount: 1,
        items: [{ kind: "update", plugin: plugin("linear"), version: "1.2.0" }],
      },
    });

    const card = await openCard();
    fireEvent.click(
      within(card).getByRole("button", { name: "Update 2 CLIs and plugins" }),
    );

    expect(startInstallMock).toHaveBeenCalledTimes(1);
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host-1",
      issue: codex,
    });
    expect(startPluginUpdateMock).toHaveBeenCalledWith("linear");
    expect(applyAppUpdateMock).not.toHaveBeenCalled();
  });

  it("skips the current updates until a new one arrives", async () => {
    appUpdateState.status = appUpdateStatus();
    const codex = providerIssue("codex", "Codex");
    const updates = {
      appUpdateAvailable: true,
      machines: [machine({ issues: [codex] })],
      plugins: {
        trackedCount: 1,
        items: [
          {
            kind: "update" as const,
            plugin: plugin("linear"),
            version: "1.2.0",
          },
        ],
      },
    };
    renderBadge(updates);

    const card = await openCard();
    fireEvent.click(within(card).getByRole("button", { name: "Skip" }));

    expect(screen.queryByTestId("sidebar-update-button")).toBeNull();

    setLive({ inventory: inventory({ ...updates, plugins: null }) });
    expect(screen.queryByTestId("sidebar-update-button")).toBeNull();

    setLive({
      inventory: inventory({
        ...updates,
        plugins: {
          trackedCount: 1,
          items: [
            { kind: "update", plugin: plugin("linear"), version: "1.3.0" },
          ],
        },
      }),
    });
    expect(
      screen.getByRole("link", { name: "3 updates available" }),
    ).toBeTruthy();

    fireEvent.click(
      within(await openCard()).getByRole("button", { name: "Skip" }),
    );
    expect(screen.queryByTestId("sidebar-update-button")).toBeNull();

    appUpdateState.status = appUpdateStatus({
      available: {
        behindSince: null,
        channel: "latest",
        commit: null,
        commitCount: null,
        subjects: [],
        version: "0.50.0",
      },
    });
    setLive({ inventory: inventory({ ...updates, plugins: null }) });
    expect(
      screen.getByRole("link", { name: "2 updates available" }),
    ).toBeTruthy();
  });

  it("leaves provider CLI updates out of the button when the preference hides them", async () => {
    preferences.showProviderCliUpdates = false;
    const codex = providerIssue("codex", "Codex");
    renderBadge({ machines: [machine({ issues: [codex] })] });
    expect(screen.queryByTestId("sidebar-update-button")).toBeNull();
    cleanup();

    live.providerJobs = { ...live.providerJobs, runningJobKey: "host-1:codex" };
    startPluginUpdateMock.mockResolvedValue({
      id: "job-1",
      pluginId: "linear",
      displayName: "linear",
      state: "queued",
    });
    renderBadge({
      machines: [machine({ issues: [codex] })],
      plugins: {
        trackedCount: 1,
        items: [{ kind: "update", plugin: plugin("linear"), version: "1.2.0" }],
      },
    });

    expect(updateButton().getAttribute("aria-label")).toBe(
      "1 update available",
    );
    const card = await openCard();
    expect(rowStates(card)).toEqual([["linear1.0.0 → 1.2.0", "available"]]);
    fireEvent.click(
      within(card).getByRole("button", { name: "Update 1 plugin" }),
    );
    expect(startPluginUpdateMock).toHaveBeenCalledWith("linear");
    expect(startInstallMock).not.toHaveBeenCalled();
  });

  it("opens the card in a drawer on a phone instead of leaving for Settings", async () => {
    appUpdateState.status = appUpdateStatus();
    const codex = providerIssue("codex", "Codex");
    live.inventory = inventory({
      appUpdateAvailable: true,
      machines: [machine({ issues: [codex] })],
    });
    const onNavigate = vi.fn();
    const { wrapper } = createQueryClientTestHarness();
    render(
      <CompactViewportOverrideProvider isCompactViewport>
        <MemoryRouter>
          <TooltipProvider>
            <SidebarProvider>
              <SidebarUpdatesBadge onNavigate={onNavigate} />
            </SidebarProvider>
            <LocationProbe />
          </TooltipProvider>
        </MemoryRouter>
      </CompactViewportOverrideProvider>,
      { wrapper },
    );

    fireEvent.click(updateButton());
    const card = await screen.findByTestId("sidebar-update-card");
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(onNavigate).not.toHaveBeenCalled();
    expect(within(card).getByText("bb 0.49.0")).toBeTruthy();

    fireEvent.click(
      within(card).getByRole("button", { name: "Update 1 agent CLI" }),
    );
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host-1",
      issue: codex,
    });
    expect(updateButton().getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(within(card).getByRole("link", { name: "Details" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/settings/updates",
    );
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(updateButton().getAttribute("aria-expanded")).toBe("false");
  });

  it("spins while updates run and shows each row's progress", async () => {
    live.providerJobs = {
      ...live.providerJobs,
      runningJobKey: "host-1:claude-code",
    };
    live.pluginJobs = [
      {
        id: "job-1",
        pluginId: "linear",
        displayName: "linear",
        state: "running",
        phase: "activating",
      },
    ];
    renderBadge({
      machines: [
        machine({ issues: [providerIssue("claude-code", "Claude Code")] }),
      ],
      plugins: {
        trackedCount: 1,
        items: [{ kind: "update", plugin: plugin("linear"), version: "1.2.0" }],
      },
    });

    const button = updateButton();
    expect(button.getAttribute("aria-label")).toBe("Updating");
    const spinner = button.querySelector('[data-icon="Loading"]');
    expect(spinner?.classList.contains("animate-spin")).toBe(true);
    const card = await openCard();
    expect(rowStates(card).map(([, state]) => state)).toEqual([
      "updating",
      "updating",
    ]);
    const busy = within(card).getByRole("button", { name: "Updating…" });
    expect(busy.hasAttribute("disabled")).toBe(true);

    setLive({
      providerJobs: { ...live.providerJobs, runningJobKey: null },
      pluginJobs: [],
    });
    expect(button.querySelector('[data-icon="Download"]')).toBeTruthy();
    expect(button.getAttribute("aria-label")).toBe("2 updates available");
  });

  it("keeps a failed update quietly in the list so it can be tried again", async () => {
    const claude = providerIssue("claude-code", "Claude Code");
    const failure: ProviderCliInstallFailure = {
      issueFingerprint: claude.fingerprint,
      kind: "command",
      logDialogState: {
        displayName: "Claude Code",
        title: "Claude Code update log",
        message: "Command exited with code 1",
        log: "",
      },
    };
    live.providerJobs = {
      ...live.providerJobs,
      failuresByJobKey: new Map([["host-1:claude-code", failure]]),
    };
    startPluginUpdateMock.mockResolvedValue({
      id: "job-2",
      pluginId: "linear",
      displayName: "linear",
      state: "queued",
    });
    live.pluginJobs = [
      {
        id: "job-1",
        pluginId: "linear",
        displayName: "linear",
        state: "failed",
        error: "network",
      },
    ];
    renderBadge({
      machines: [
        machine({ issues: [claude, providerIssue("codex", "Codex")] }),
      ],
      plugins: {
        trackedCount: 1,
        items: [{ kind: "update", plugin: plugin("linear"), version: "1.2.0" }],
      },
    });

    expect(updateButton().querySelector('[data-icon="Download"]')).toBeTruthy();
    const card = await openCard();
    expect(rowStates(card)).toEqual([
      ["Claude CodeFailed · try again", "failed"],
      ["Codex1.0.0 → 1.1.0", "available"],
      ["linearFailed · try again", "failed"],
    ]);
    fireEvent.click(
      within(card).getByRole("button", { name: "Update 3 CLIs and plugins" }),
    );
    expect(startInstallMock).toHaveBeenCalledTimes(2);
    expect(startPluginUpdateMock).toHaveBeenCalledWith("linear");
  });

  it("offers Try again when only failed updates are left", async () => {
    const claude = providerIssue("claude-code", "Claude Code");
    live.providerJobs = {
      ...live.providerJobs,
      failuresByJobKey: new Map([
        [
          "host-1:claude-code",
          {
            issueFingerprint: claude.fingerprint,
            kind: "command",
            logDialogState: {
              displayName: "Claude Code",
              title: "Claude Code update log",
              message: "Command exited with code 1",
              log: "",
            },
          },
        ],
      ]),
    };
    renderBadge({ machines: [machine({ issues: [claude] })] });

    const card = await openCard();
    fireEvent.click(within(card).getByRole("button", { name: "Try again" }));
    expect(startInstallMock).toHaveBeenCalledWith({
      hostId: "host-1",
      issue: claude,
    });
  });

  it("shows bb restarting and spins the button until it comes back", async () => {
    appUpdateState.status = appUpdateStatus({
      activity: {
        phase: "restarting",
        startedAt: "2026-11-06T23:00:00.000Z",
        targetCommit: null,
        targetVersion: "0.49.0",
      },
    });
    renderBadge({ appUpdateAvailable: true });

    expect(updateButton().getAttribute("aria-label")).toBe("Updating");
    const card = await openCard();
    expect(card.textContent).toContain("Restarting into the update…");
    expect(within(card).queryByRole("button", { name: /^Restart/ })).toBe(null);
  });

  it("leaves out missing CLIs and names machines when a CLI is stale on several", async () => {
    renderBadge({
      machines: [
        machine({
          host: host("laptop"),
          issues: [
            providerIssue("codex", "Codex"),
            missingInstallIssue("claude-code", "Claude Code"),
          ],
        }),
        machine({
          host: host("studio"),
          issues: [providerIssue("codex", "Codex")],
        }),
      ],
    });

    const card = await openCard();
    expect(rowStates(card).map(([text]) => text)).toEqual([
      "Codexlaptop · 1.0.0 → 1.1.0",
      "Codexstudio · 1.0.0 → 1.1.0",
    ]);
  });

  it("acknowledges offline machines across reloads without suppressing real updates", () => {
    const offline = machine({
      host: makeHost({
        id: "offline",
        name: "Work laptop",
        status: "disconnected",
        lastSeenAt: 100,
        lastRejectedProtocolVersion: 1,
      }),
      canRetryDaemonUpdate: true,
    });
    renderBadge({ machines: [offline] });
    expect(screen.queryByTestId("sidebar-update-button")).toBeNull();
    const warning = screen.getByRole("link", {
      name: "Work laptop is offline",
    });
    expect(warning.getAttribute("href")).toBe("/settings/machines");
    fireEvent.click(warning);
    expect(screen.queryByTestId("sidebar-machines-attention-badge")).toBeNull();
    cleanup();

    renderBadge({ isLoading: true });
    setLive({
      inventory: inventory({
        machines: [
          {
            ...offline,
            host: { ...offline.host, lastRejectedProtocolVersion: 2 },
          },
        ],
        appUpdateAvailable: true,
      }),
    });
    expect(screen.queryByTestId("sidebar-machines-attention-badge")).toBeNull();
    expect(screen.getByTestId("sidebar-update-button")).toBeTruthy();
    cleanup();

    renderBadge({
      machines: [{ ...offline, host: { ...offline.host, lastSeenAt: 200 } }],
    });
    expect(screen.getByTestId("sidebar-machines-attention-badge")).toBeTruthy();
  });

  it("keeps acknowledged hosts quiet when peers recover and reports new issues", () => {
    const first = machine({
      host: makeHost({ id: "first", status: "disconnected" }),
    });
    const second = machine({
      host: makeHost({ id: "second", status: "disconnected" }),
    });
    renderBadge({ machines: [first, second] });
    fireEvent.click(screen.getByRole("link", { name: "Machines offline" }));
    setLive({ inventory: inventory({ machines: [first] }) });
    expect(screen.queryByTestId("sidebar-machines-attention-badge")).toBeNull();

    setLive({
      inventory: inventory({
        machines: [
          first,
          { ...second, host: { ...second.host, status: "connected" } },
        ],
      }),
    });
    setLive({ inventory: inventory({ machines: [first, second] }) });
    expect(screen.getByRole("link", { name: "Machines offline" })).toBeTruthy();
  });

  it("does not warn about intentionally paused machines or ephemeral hosts", () => {
    const paused = makeHost({ status: "disconnected" });
    paused.lifecycle.phase = "suspended";
    renderBadge({
      machines: [
        machine({ host: paused }),
        machine({
          host: makeHost({ status: "disconnected", type: "ephemeral" }),
        }),
      ],
    });
    expect(screen.queryByTestId("sidebar-machines-attention-badge")).toBeNull();
  });
});
