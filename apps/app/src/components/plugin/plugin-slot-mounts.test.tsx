// @vitest-environment jsdom

import { MemoryRouter, Route, Routes } from "react-router-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type {
  PluginComposerAccessoryProps,
  PluginHomepageSectionProps,
  PluginThreadPanelTabProps,
} from "@bb/plugin-sdk";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { PLUGIN_PANEL_ROUTE_PATH } from "@/lib/route-paths";
import { PluginPanelView } from "@/views/PluginPanelView";
import { resetAllCrashedPluginSlotsForTest } from "./PluginSlotMount";
import { PluginComposerAccessories } from "./PluginComposerAccessories";
import { PluginHomepageSections } from "./PluginHomepageSections";
import { PluginNavSidebarItems } from "./PluginNavSidebarItems";
import {
  PluginThreadPanelTabButtons,
  PluginThreadPanelTabContent,
} from "./PluginThreadPanelTabs";

function registrationSet(
  overrides: Partial<PluginRegistrationSet>,
): PluginRegistrationSet {
  return {
    homepageSections: [],
    navPanels: [],
    threadPanelTabs: [],
    composerAccessories: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
});

describe("PluginHomepageSections", () => {
  it("renders nothing without registrations (and without a Router)", () => {
    const { container } = render(<PluginHomepageSections />);
    expect(container.innerHTML).toBe("");
  });

  it("renders registered sections with the route project id", () => {
    function SectionProbe({ projectId }: PluginHomepageSectionProps) {
      return <div>section projectId: {String(projectId)}</div>;
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        homepageSections: [
          { id: "hello", title: "Demo section", component: SectionProbe },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/projects/proj_123"]}>
        <PluginHomepageSections />
      </MemoryRouter>,
    );
    expect(screen.getByText("Demo section")).toBeDefined();
    expect(screen.getByText("section projectId: proj_123")).toBeDefined();
  });

  it("contains a crashing section without hiding its sibling", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashes(): never {
      throw new Error("section crashed");
    }
    function Fine() {
      return <div>fine section body</div>;
    }
    setPluginSlotRegistrations(
      "broken",
      registrationSet({
        homepageSections: [{ id: "a", title: "Broken", component: Crashes }],
      }),
    );
    setPluginSlotRegistrations(
      "fine",
      registrationSet({
        homepageSections: [{ id: "b", title: "Fine", component: Fine }],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginHomepageSections />
      </MemoryRouter>,
    );
    expect(screen.getByText("plugin broken crashed")).toBeDefined();
    expect(screen.getByText("fine section body")).toBeDefined();
  });
});

describe("PluginComposerAccessories", () => {
  it("passes the route thread + project context", () => {
    function AccessoryProbe({
      projectId,
      threadId,
    }: PluginComposerAccessoryProps) {
      return (
        <div>
          accessory {String(projectId)} / {String(threadId)}
        </div>
      );
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        composerAccessories: [{ id: "probe", component: AccessoryProbe }],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/threads/thr_9"]}>
        <PluginComposerAccessories />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(`accessory ${PERSONAL_PROJECT_ID} / thr_9`),
    ).toBeDefined();
  });
});

describe("PluginNavSidebarItems + PluginPanelView", () => {
  function Board() {
    return <div>board panel body</div>;
  }

  it("renders a sidebar entry that routes to the plugin panel", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          {
            id: "board",
            title: "Demo board",
            icon: "columns",
            path: "board",
            component: Board,
          },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginNavSidebarItems />
        <Routes>
          <Route path="/" element={<div>home</div>} />
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Demo board"));
    expect(screen.getByText("board panel body")).toBeDefined();
  });

  it("shows a placeholder for an unknown plugin panel route", () => {
    render(
      <MemoryRouter initialEntries={["/plugins/ghost/board"]}>
        <Routes>
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/This plugin panel is not available/),
    ).toBeDefined();
  });
});

describe("plugin thread panel tabs", () => {
  function TabProbe({ threadId }: PluginThreadPanelTabProps) {
    return <div>tab body for {threadId}</div>;
  }

  it("shows a button per visible tab and reports the panel key on click", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelTabs: [
          { id: "issue", title: "Issue", component: TabProbe },
          {
            id: "hidden",
            title: "Hidden",
            component: TabProbe,
            visible: () => false,
          },
        ],
      }),
    );
    const onPanelChange = vi.fn();
    render(
      <MemoryRouter initialEntries={["/threads/thr_9"]}>
        <PluginThreadPanelTabButtons
          activePanel="thread-info"
          hasActiveFileTab={false}
          onPanelChange={onPanelChange}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Hidden")).toBeNull();
    fireEvent.click(screen.getByText("Issue"));
    expect(onPanelChange).toHaveBeenCalledWith("plugin:demo:issue");
  });

  it("hides a tab whose visible() throws instead of crashing the strip", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelTabs: [
          {
            id: "explosive",
            title: "Explosive",
            component: TabProbe,
            visible: () => {
              throw new Error("predicate exploded");
            },
          },
          { id: "steady", title: "Steady", component: TabProbe },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/threads/thr_9"]}>
        <PluginThreadPanelTabButtons
          activePanel="thread-info"
          hasActiveFileTab={false}
          onPanelChange={() => {}}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText("Explosive")).toBeNull();
    expect(screen.getByText("Steady")).toBeDefined();
  });

  it("renders the active tab's component with the route thread id", () => {
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        threadPanelTabs: [
          { id: "issue", title: "Issue", component: TabProbe },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/threads/thr_9"]}>
        <PluginThreadPanelTabContent panelKey="plugin:demo:issue" />
      </MemoryRouter>,
    );
    expect(screen.getByText("tab body for thr_9")).toBeDefined();
  });

  it("degrades to a placeholder when the selected tab is gone", () => {
    render(
      <MemoryRouter initialEntries={["/threads/thr_9"]}>
        <PluginThreadPanelTabContent panelKey="plugin:ghost:issue" />
      </MemoryRouter>,
    );
    expect(screen.getByText(/This plugin tab is not available/)).toBeDefined();
  });
});
