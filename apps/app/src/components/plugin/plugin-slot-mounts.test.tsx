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
  resetPluginLogoStoreForTest,
  setPluginLogoUrls,
} from "@/lib/plugin-logos";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
  type PluginNavPanelSlot,
  type PluginRegistrationSet,
} from "@/lib/plugin-slots";
import { PLUGIN_PANEL_ROUTE_PATH } from "@/lib/route-paths";
import { PluginPanelView } from "@/views/PluginPanelView";
import {
  PluginPanelHeaderActions,
  PluginPanelHeaderCenter,
} from "./PluginPanelHeader";
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
  resetPluginLogoStoreForTest();
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

  it("renders the plugin's logo in the sidebar row when one is served, named icon otherwise", () => {
    setPluginLogoUrls(
      new Map([
        ["demo", { logoUrl: "/api/v1/plugins/demo/assets/logo?h=cafe", logoDarkUrl: null }],
      ]),
    );
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          { id: "board", title: "Demo board", icon: "Columns", path: "board", component: Board },
        ],
      }),
    );
    setPluginSlotRegistrations(
      "plain",
      registrationSet({
        navPanels: [
          { id: "list", title: "Plain list", icon: "Columns", path: "list", component: Board },
        ],
      }),
    );
    render(
      <MemoryRouter initialEntries={["/"]}>
        <PluginNavSidebarItems />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("plugin-logo-demo").getAttribute("src"),
    ).toBe("/api/v1/plugins/demo/assets/logo?h=cafe");
    // No logo → named-icon fallback (an svg, no img).
    expect(screen.queryByTestId("plugin-logo-plain")).toBeNull();
    const plainRow = screen.getByText("Plain list").closest("button");
    expect(plainRow?.querySelector("svg")).not.toBeNull();
  });
});

describe("plugin panel chrome (shared header + body modes)", () => {
  function PanelBody() {
    return <div>panel body</div>;
  }

  function panelSlot(
    overrides: Partial<PluginNavPanelSlot>,
  ): PluginNavPanelSlot {
    return {
      id: "board",
      title: "Demo board",
      icon: "Columns",
      path: "board",
      component: PanelBody,
      pluginId: "demo",
      generation: 1,
      ...overrides,
    };
  }

  function renderPanelBody(route = "/plugins/demo/board") {
    return render(
      <MemoryRouter initialEntries={[route]}>
        <Routes>
          <Route path={PLUGIN_PANEL_ROUTE_PATH} element={<PluginPanelView />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("renders logo + title in the header center and headerContent in the actions", () => {
    setPluginLogoUrls(
      new Map([
        ["demo", { logoUrl: "/api/v1/plugins/demo/assets/logo?h=cafe", logoDarkUrl: null }],
      ]),
    );
    function HeaderAccessory() {
      return <button type="button">Sync now</button>;
    }
    const panel = panelSlot({ headerContent: HeaderAccessory });
    render(
      <>
        <PluginPanelHeaderCenter panel={panel} />
        <PluginPanelHeaderActions panel={panel} />
      </>,
    );
    expect(screen.getByText("Demo board")).toBeDefined();
    expect(
      screen.getByTestId("plugin-logo-demo").getAttribute("src"),
    ).toBe("/api/v1/plugins/demo/assets/logo?h=cafe");
    expect(screen.getByRole("button", { name: "Sync now" })).toBeDefined();
  });

  it("hides a throwing headerContent without breaking the header (no crash chip)", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function ExplodingAccessory(): never {
      throw new Error("accessory exploded");
    }
    const panel = panelSlot({ headerContent: ExplodingAccessory });
    render(
      <>
        <PluginPanelHeaderCenter panel={panel} />
        <PluginPanelHeaderActions panel={panel} />
      </>,
    );
    // The header center survives; the accessory is hidden, not chip-ified.
    expect(screen.getByText("Demo board")).toBeDefined();
    expect(screen.queryByText(/plugin demo crashed/)).toBeNull();
  });

  it('suppresses headerContent in "none" mode (the plugin owns the body)', () => {
    function HeaderAccessory() {
      return <button type="button">ignored</button>;
    }
    const panel = panelSlot({
      chrome: "none",
      headerContent: HeaderAccessory,
    });
    const { container } = render(<PluginPanelHeaderActions panel={panel} />);
    expect(container.innerHTML).toBe("");
  });

  it('renders the body full-bleed in "none" mode with no heading of its own', () => {
    function FullBleed() {
      return <div>full bleed body</div>;
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [
          panelSlot({ component: FullBleed, chrome: "none" }),
        ],
      }),
    );
    renderPanelBody();
    expect(screen.getByText("full bleed body")).toBeDefined();
    // The view is body-only: the title lives in the shared app header.
    expect(screen.queryByRole("heading", { name: "Demo board" })).toBeNull();
  });

  it('still contains a crashing "none" panel inside the error boundary', () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    function Crashes(): never {
      throw new Error("panel crashed");
    }
    setPluginSlotRegistrations(
      "demo",
      registrationSet({
        navPanels: [panelSlot({ component: Crashes, chrome: "none" })],
      }),
    );
    renderPanelBody();
    expect(screen.getByText("plugin demo crashed")).toBeDefined();
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
