// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { defaultAppSettings, type AppSettings } from "@bb/domain";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SetupChecklistBanner,
  hasSetupChecklistBanner,
  useSetupChecklist,
} from "./SetupChecklistHost";
import { onboardingReopenStepAtom } from "./onboarding-state";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  recordTelemetryEvent: vi.fn(),
  startThread: vi.fn(),
  useHosts: vi.fn(),
  usePluginList: vi.fn(),
  usePrimaryHost: vi.fn(),
  useSidebarNavigation: vi.fn(),
  useSystemConfig: vi.fn(),
  useSystemProviderStates: vi.fn(),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.useSystemConfig,
  useSystemProviderStates: mocks.useSystemProviderStates,
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({ mutate: mocks.mutate }),
}));
vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: mocks.useHosts,
  usePrimaryHost: mocks.usePrimaryHost,
}));
vi.mock("@/hooks/queries/plugin-settings-queries", () => ({
  usePluginList: mocks.usePluginList,
}));
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: mocks.useSidebarNavigation,
}));
vi.mock("./onboarding-telemetry", () => ({
  recordTelemetryEvent: mocks.recordTelemetryEvent,
}));

const CONNECT_ON = {
  providers: [
    {
      id: "connect",
      displayName: "bb connect",
      description: "",
      pluginId: "connect",
      availability: {
        status: "available",
        serverUrl: "https://sawyer.getbb.app",
      },
    },
  ],
  defaultProviderId: "connect",
  effectiveUrl: "https://sawyer.getbb.app",
  urlSource: null,
};
const CONNECT_OFF = { ...CONNECT_ON, providers: [] };

interface Scenario {
  settings?: Partial<AppSettings>;
  agentStatuses?: readonly string[];
  projectCount?: number;
  threadCount?: number;
  enabledPluginIds?: readonly string[];
  connectOn?: boolean;
}

function arrange({
  settings = {},
  agentStatuses = ["unauthenticated"],
  projectCount = 0,
  threadCount = 0,
  enabledPluginIds = [],
  connectOn = false,
}: Scenario) {
  mocks.useSystemConfig.mockReturnValue({
    data: {
      generalSettings: {
        ...defaultAppSettings,
        onboardingCompletedAt: "2026-10-01T00:00:00.000Z",
        setupChecklistVisible: true,
        ...settings,
      },
      serverAccess: connectOn ? CONNECT_ON : CONNECT_OFF,
    },
  });
  mocks.usePrimaryHost.mockReturnValue({ id: "host-1" });
  mocks.useHosts.mockReturnValue({ data: [{ id: "host-1" }] });
  mocks.useSystemProviderStates.mockReturnValue({
    data: {
      providers: agentStatuses.map((status, index) => ({
        providerId: `provider-${index}`,
        status,
      })),
    },
  });
  mocks.useSidebarNavigation.mockReturnValue({
    data: {
      projects: Array.from({ length: projectCount }, (_, index) => ({
        id: `proj_${index}`,
        threads: [],
      })),
      personalProject: {
        threads: Array.from({ length: threadCount }, (_, index) => ({
          id: `thr_${index}`,
        })),
      },
    },
  });
  mocks.usePluginList.mockReturnValue({
    data: {
      plugins: enabledPluginIds.map((id) => ({ id, enabled: true })),
    },
  });
}

function Harness() {
  const checklist = useSetupChecklist({ onStartThread: mocks.startThread });
  return (
    <>
      <span data-testid="has-banner">
        {String(hasSetupChecklistBanner(checklist))}
      </span>
      <SetupChecklistBanner checklist={checklist} />
    </>
  );
}

function renderHarness() {
  const store = createStore();
  render(
    <Provider store={store}>
      <Harness />
    </Provider>,
  );
  return store;
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function telemetryEvents(name: string) {
  return mocks.recordTelemetryEvent.mock.calls
    .map(([event]) => event)
    .filter((event) => event.name === name);
}

describe("setup checklist", () => {
  it("stays out of the way for installs that never opted into the checklist", () => {
    arrange({ settings: { setupChecklistVisible: false } });

    renderHarness();

    expect(screen.getByTestId("has-banner").textContent).toBe("false");
    expect(screen.queryByText("Finish setting up bb")).toBeNull();
    expect(screen.queryByText(/No agent is ready/u)).toBeNull();
    expect(mocks.useSystemProviderStates).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
    );
  });

  it("leads with the missing agent and reopens setup at the agent step", () => {
    arrange({ agentStatuses: ["unauthenticated", "not_installed"] });

    const store = renderHarness();

    expect(screen.getByText("No agent is ready on this computer")).toBeTruthy();
    fireEvent.click(screen.getByText("Connect an agent"));
    expect(store.get(onboardingReopenStepAtom)).toBe("agent");
  });

  it("does not claim the agent is missing when a provider could not be checked", () => {
    arrange({ agentStatuses: ["unauthenticated", "unknown"] });

    renderHarness();

    expect(screen.queryByText(/No agent is ready/u)).toBeNull();
    expect(screen.getByText("Finish setting up bb")).toBeTruthy();
  });

  it("points the compact banner at the first required step that is still open", () => {
    arrange({ agentStatuses: ["ready"], projectCount: 2 });

    const store = renderHarness();

    expect(
      screen.getByText("2 of 3 done · next: start your first thread"),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Continue"));
    expect(mocks.startThread).toHaveBeenCalledTimes(1);
    expect(store.get(onboardingReopenStepAtom)).toBeNull();
  });

  it("offers optional extras with their reason once the required steps are done", () => {
    arrange({ agentStatuses: ["ready"], projectCount: 1, threadCount: 1 });

    const store = renderHarness();

    expect(screen.getByText("Optional: Pick plugins")).toBeTruthy();
    expect(
      screen.getByText(
        "Browser automation, workflows, and more. Off until you want them.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Browse" }));
    expect(store.get(onboardingReopenStepAtom)).toBe("plugins");
  });

  it("offers notifications only on a click and records the answer", async () => {
    const requestPermission = vi.fn(async () => "granted" as const);
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal("isSecureContext", true);
    arrange({
      agentStatuses: ["ready"],
      projectCount: 1,
      threadCount: 1,
      enabledPluginIds: ["workflows", "push-notifications"],
      connectOn: true,
    });

    renderHarness();

    expect(screen.getByText("Optional: Turn on notifications")).toBeTruthy();
    expect(requestPermission).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() =>
      expect(telemetryEvents("notification_prompt_accepted")).toEqual([
        {
          name: "notification_prompt_accepted",
          properties: { surface: "checklist" },
        },
      ]),
    );
    expect(requestPermission).toHaveBeenCalledTimes(1);
  });

  it("drops the notification item once the browser denied permission", () => {
    vi.stubGlobal("Notification", {
      permission: "denied",
      requestPermission: vi.fn(),
    });
    vi.stubGlobal("isSecureContext", true);
    arrange({
      agentStatuses: ["ready"],
      projectCount: 1,
      threadCount: 1,
      enabledPluginIds: ["workflows", "push-notifications"],
      connectOn: true,
    });

    renderHarness();

    expect(screen.queryByText("Optional: Turn on notifications")).toBeNull();
    expect(screen.getByTestId("has-banner").textContent).toBe("false");
  });

  it("counts steps already done as a head start, then reports new completions once", () => {
    arrange({ agentStatuses: ["ready"] });
    renderHarness();

    expect(telemetryEvents("setup_checklist_item_completed")).toEqual([
      {
        name: "setup_checklist_item_completed",
        properties: { item: "agent", optional: false, head_start: true },
      },
    ]);
    cleanup();
    mocks.recordTelemetryEvent.mockClear();

    arrange({ agentStatuses: ["ready"], threadCount: 1 });
    renderHarness();

    expect(telemetryEvents("setup_checklist_item_completed")).toEqual([
      {
        name: "setup_checklist_item_completed",
        properties: { item: "thread", optional: false, head_start: false },
      },
    ]);
  });

  it("turns the checklist off when dismissed, keeping other settings", () => {
    arrange({ agentStatuses: ["ready"], settings: { streamerMode: true } });

    renderHarness();
    fireEvent.click(screen.getByLabelText("Dismiss setup checklist"));

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        setupChecklistVisible: false,
        streamerMode: true,
        onboardingCompletedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
    expect(telemetryEvents("setup_checklist_dismissed")).toEqual([
      {
        name: "setup_checklist_dismissed",
        properties: {
          required_done: 1,
          required_total: 3,
          optional_done: 0,
          optional_total: 2,
        },
      },
    ]);
  });

  it("clears itself once every step is done instead of lingering hidden", () => {
    arrange({
      agentStatuses: ["ready"],
      projectCount: 1,
      threadCount: 1,
      enabledPluginIds: ["workflows"],
      connectOn: true,
    });

    renderHarness();

    expect(screen.getByTestId("has-banner").textContent).toBe("false");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ setupChecklistVisible: false }),
    );
    expect(telemetryEvents("setup_checklist_dismissed")).toEqual([]);
  });
});
