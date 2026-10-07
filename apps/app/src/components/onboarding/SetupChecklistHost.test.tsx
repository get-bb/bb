// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { defaultAppSettings, type AppSettings } from "@bb/domain";
import { Provider, createStore } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SetupChecklistBanner,
  SetupChecklistCard,
  hasSetupChecklistBanner,
  useSetupChecklist,
} from "./SetupChecklistHost";
import { onboardingReopenStepAtom } from "./onboarding-state";

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
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
  enabledPluginIds?: readonly string[];
  connectOn?: boolean;
}

function arrange({
  settings = {},
  agentStatuses = ["unauthenticated"],
  projectCount = 0,
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
      })),
    },
  });
  mocks.usePluginList.mockReturnValue({
    data: {
      plugins: enabledPluginIds.map((id) => ({ id, enabled: true })),
    },
  });
}

function Harness() {
  const checklist = useSetupChecklist();
  return (
    <>
      <span data-testid="has-banner">
        {String(hasSetupChecklistBanner(checklist))}
      </span>
      <SetupChecklistCard checklist={checklist} />
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
});

afterEach(() => {
  cleanup();
});

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
    fireEvent.click(screen.getAllByText("Connect an agent")[0] as HTMLElement);
    expect(store.get(onboardingReopenStepAtom)).toBe("agent");
  });

  it("does not claim the agent is missing when a provider could not be checked", () => {
    arrange({ agentStatuses: ["unauthenticated", "unknown"] });

    renderHarness();

    expect(screen.queryByText(/No agent is ready/u)).toBeNull();
    expect(screen.getAllByText("Finish setting up bb").length).toBeGreaterThan(
      0,
    );
  });

  it("points the compact banner at the first step that is still open", () => {
    arrange({ agentStatuses: ["ready"], projectCount: 2 });

    const store = renderHarness();

    expect(
      screen.getByText("2 of 4 done · next: pick some plugins"),
    ).toBeTruthy();
    fireEvent.click(screen.getByText("Continue"));
    expect(store.get(onboardingReopenStepAtom)).toBe("plugins");
  });

  it("turns the checklist off when dismissed, keeping other settings", () => {
    arrange({ agentStatuses: ["ready"], settings: { streamerMode: true } });

    renderHarness();
    fireEvent.click(
      screen.getAllByLabelText("Dismiss setup checklist")[0] as HTMLElement,
    );

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        setupChecklistVisible: false,
        streamerMode: true,
        onboardingCompletedAt: "2026-10-01T00:00:00.000Z",
      }),
    );
  });

  it("clears itself once every step is done instead of lingering hidden", () => {
    arrange({
      agentStatuses: ["ready"],
      projectCount: 1,
      enabledPluginIds: ["workflows"],
      connectOn: true,
    });

    renderHarness();

    expect(screen.getByTestId("has-banner").textContent).toBe("false");
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({ setupChecklistVisible: false }),
    );
  });
});
