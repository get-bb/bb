// @vitest-environment jsdom

import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { PluginContext } from "@/components/plugin/plugin-context";
import { SidebarHistoryNavigationControls } from "@/components/sidebar/SidebarHistoryNavigationControls";
import { useBbNavigate } from "./plugin-sdk-hooks";
import {
  AUTOMATIONS_PLUGIN_ID,
  AUTOMATIONS_PLUGIN_PANEL_PATH,
  getPluginPanelRoutePath,
  getAutomationDetailRoutePath,
  getAutomationEditRoutePath,
  getAutomationsRoutePath,
  getSkillDetailRoutePath,
} from "./route-paths";
import {
  resetAppRouteHistoryForTest,
  useRouteStateHistoryNavigation,
} from "./app-route-history";

const TOOL_SKILL_DETAIL_ROUTE = getSkillDetailRoutePath({
  skillId: "skill_review_loop",
});

const TOOL_ROUTE_SEQUENCE = [
  "/skills",
  "/skills/registry",
  TOOL_SKILL_DETAIL_ROUTE,
  "/skills/registry/moss-skills%2Fmoss-notes",
  "/plugins",
  "/plugins/github",
] as const;

function HistoryHarness({ routes = TOOL_ROUTE_SEQUENCE }: { routes?: readonly string[] }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { canGoBack, canGoForward, goBack, goForward } =
    useRouteStateHistoryNavigation();

  return (
    <div>
      <div data-testid="path">{location.pathname}{location.search}{location.hash}</div>
      <div data-testid="can-go-back">{String(canGoBack)}</div>
      <div data-testid="can-go-forward">{String(canGoForward)}</div>
      <button type="button" onClick={goBack}>
        Back
      </button>
      <button type="button" onClick={goForward}>
        Forward
      </button>
      {routes.map((path) => (
        <button key={path} type="button" onClick={() => navigate(path)}>
          {path}
        </button>
      ))}
    </div>
  );
}

function RemountableHistoryHarness() {
  const [mounted, setMounted] = useState(true);
  const navigate = useNavigate();
  return (
    <div>
      <button type="button" onClick={() => setMounted((value) => !value)}>
        toggle-harness
      </button>
      <button type="button" onClick={() => navigate("/")}>
        go-home
      </button>
      {mounted ? <HistoryHarness /> : null}
    </div>
  );
}

function SidebarControlsHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
      <SidebarHistoryNavigationControls />
      {TOOL_ROUTE_SEQUENCE.map((path) => (
        <button key={path} type="button" onClick={() => navigate(path)}>
          {path}
        </button>
      ))}
    </div>
  );
}

const AUTOMATION_ROUTE = {
  projectId: "proj_standard",
  automationId: "auto_standard",
} as const;

function PluginNavigationHarness() {
  const location = useLocation();
  const navigate = useNavigate();
  const pluginNavigate = useBbNavigate();
  const detailPath = getAutomationDetailRoutePath(AUTOMATION_ROUTE);
  const editSubPath = `${AUTOMATION_ROUTE.projectId}/${AUTOMATION_ROUTE.automationId}/edit`;
  const detailSubPath = `${AUTOMATION_ROUTE.projectId}/${AUTOMATION_ROUTE.automationId}`;

  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
      <button type="button" onClick={() => navigate(detailPath)}>
        Open detail
      </button>
      <button
        type="button"
        onClick={() =>
          pluginNavigate.toPluginPanel(AUTOMATIONS_PLUGIN_PANEL_PATH, {
            subPath: editSubPath,
          })
        }
      >
        Edit from detail
      </button>
      <button
        type="button"
        onClick={() =>
          pluginNavigate.toPluginPanel(AUTOMATIONS_PLUGIN_PANEL_PATH, {
            subPath: editSubPath,
          })
        }
      >
        Open direct edit
      </button>
      <button
        type="button"
        onClick={() =>
          pluginNavigate.toCompose({
            initialPrompt: "Edit this automation",
          })
        }
      >
        Redirect edit to compose
      </button>
      <button
        type="button"
        onClick={() =>
          pluginNavigate.toPluginPanel(AUTOMATIONS_PLUGIN_PANEL_PATH, {
            subPath: detailSubPath,
            replace: true,
          })
        }
      >
        Exit edit
      </button>
      <button type="button" onClick={() => navigate(-1)}>
        Native back
      </button>
    </div>
  );
}

function RemountablePluginNavigationHarness() {
  const [mountKey, setMountKey] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setMountKey((value) => value + 1)}>
        Remount plugin
      </button>
      <PluginContext.Provider value={AUTOMATIONS_PLUGIN_ID}>
        <PluginNavigationHarness key={mountKey} />
      </PluginContext.Provider>
    </>
  );
}

async function clickAndExpectPath(label: string, path: string) {
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => {
    expect(screen.getByTestId("path").textContent).toBe(path);
  });
}

async function expectSidebarButtonState(
  label: "Go back" | "Go forward",
  disabled: boolean,
) {
  await waitFor(() => {
    expect(
      (screen.getByRole("button", { name: label }) as HTMLButtonElement)
        .disabled,
    ).toBe(disabled);
  });
}

describe("useRouteStateHistoryNavigation", () => {
  afterEach(() => {
    cleanup();
    resetAppRouteHistoryForTest();
  });

  it("keeps the stack when the controls remount across sidebar layouts", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <RemountableHistoryHarness />
      </MemoryRouter>,
    );
    await clickAndExpectPath("/skills", "/skills");
    expect(screen.getByTestId("can-go-back").textContent).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "toggle-harness" }));
    expect(screen.queryByTestId("can-go-back")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "go-home" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle-harness" }));

    expect(screen.getByTestId("path").textContent).toBe("/");
    expect(screen.getByTestId("can-go-back").textContent).toBe("true");
    await clickAndExpectPath("Back", "/skills");
  });

  it("tracks collection routes while skipping plugin detail selections", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <HistoryHarness />
      </MemoryRouter>,
    );

    for (const path of TOOL_ROUTE_SEQUENCE) {
      await clickAndExpectPath(path, path);
    }

    expect(screen.getByTestId("can-go-back").textContent).toBe("true");
    expect(screen.getByTestId("can-go-forward").textContent).toBe("false");

    await clickAndExpectPath(
      "Back",
      "/skills/registry/moss-skills%2Fmoss-notes",
    );
    await clickAndExpectPath("Back", TOOL_SKILL_DETAIL_ROUTE);
    await clickAndExpectPath("Back", "/skills/registry");
    await clickAndExpectPath("Back", "/skills");
    await clickAndExpectPath("Back", "/");

    expect(screen.getByTestId("can-go-back").textContent).toBe("false");
    expect(screen.getByTestId("can-go-forward").textContent).toBe("true");

    await clickAndExpectPath("Forward", "/skills");
    await clickAndExpectPath("Forward", "/skills/registry");
    await clickAndExpectPath("Forward", TOOL_SKILL_DETAIL_ROUTE);
    await clickAndExpectPath(
      "Forward",
      "/skills/registry/moss-skills%2Fmoss-notes",
    );
    await clickAndExpectPath("Forward", "/plugins/github");
  });

  it.each([
    "?view=installed&query=notes",
    "?category=security&sort=name&direction=desc",
    "?author=get-bb",
    "?shelf=bb-official",
  ])("skips tab-only entries in both directions for %s", async (context) => {
    const routes = [
      `/plugins${context}`,
      `/plugins/memory${context}`,
      `/plugins/github${context}`,
      "/settings/plugins/github",
    ];
    render(
      <MemoryRouter initialEntries={["/skills"]}>
        <HistoryHarness routes={routes} />
      </MemoryRouter>,
    );
    for (const route of routes) await clickAndExpectPath(route, route);
    await clickAndExpectPath("Back", routes[2]);
    await clickAndExpectPath("Back", "/skills");
    await clickAndExpectPath("Forward", routes[2]);
    await clickAndExpectPath("Forward", routes[3]);
  });

  it("preserves collection changes and plugin workspace navigation", async () => {
    const routes = [
      "/plugins?view=installed",
      "/plugins/memory?view=installed",
      "/plugins/memory?view=installed&query=memory",
      "/plugins/github?view=installed&query=memory",
      "/plugins/github?author=get-bb",
      "/plugins/github/repositories",
      "/settings/plugins/github",
    ];
    render(
      <MemoryRouter initialEntries={["/skills"]}>
        <HistoryHarness routes={routes} />
      </MemoryRouter>,
    );
    for (const route of routes) await clickAndExpectPath(route, route);
    for (const route of [routes[5], routes[4], routes[3], routes[1], "/skills"])
      await clickAndExpectPath("Back", route);
    for (const route of [routes[1], routes[3], routes[4], routes[5], routes[6]])
      await clickAndExpectPath("Forward", route);
  });

  it("does not invent a Back target for a direct plugin link", async () => {
    render(
      <MemoryRouter initialEntries={["/plugins/memory?view=installed"]}>
        <HistoryHarness routes={["/plugins/github?view=installed"]} />
      </MemoryRouter>,
    );
    await clickAndExpectPath("/plugins/github?view=installed", "/plugins/github?view=installed");
    expect(screen.getByTestId("can-go-back").textContent).toBe("false");
  });

  it("updates the actual sidebar arrow buttons after Tools route clicks", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SidebarControlsHarness />
      </MemoryRouter>,
    );

    await expectSidebarButtonState("Go back", true);
    await expectSidebarButtonState("Go forward", true);

    await clickAndExpectPath("/skills", "/skills");

    await expectSidebarButtonState("Go back", false);
    await expectSidebarButtonState("Go forward", true);

    await clickAndExpectPath(TOOL_SKILL_DETAIL_ROUTE, TOOL_SKILL_DETAIL_ROUTE);
    await clickAndExpectPath("Go back", "/skills");

    await expectSidebarButtonState("Go forward", false);
  });

  it("redirects remounted automation edit routes without duplicate history entries", async () => {
    render(
      <MemoryRouter initialEntries={[getAutomationsRoutePath()]}>
        <RemountablePluginNavigationHarness />
      </MemoryRouter>,
    );

    const detailPath = getAutomationDetailRoutePath(AUTOMATION_ROUTE);
    const editPath = getAutomationEditRoutePath(AUTOMATION_ROUTE);

    await clickAndExpectPath("Open detail", detailPath);
    await clickAndExpectPath("Edit from detail", editPath);
    await clickAndExpectPath("Remount plugin", editPath);
    await clickAndExpectPath("Redirect edit to compose", "/");
    await clickAndExpectPath("Native back", detailPath);
    await clickAndExpectPath("Native back", getAutomationsRoutePath());

    await clickAndExpectPath("Open direct edit", editPath);
    await clickAndExpectPath("Remount plugin", editPath);
    await clickAndExpectPath("Redirect edit to compose", "/");
    await clickAndExpectPath("Native back", getAutomationsRoutePath());
  });

  it("keeps Automations on its plugin panel route", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <RemountablePluginNavigationHarness />
      </MemoryRouter>,
    );

    const editSubPath = `${AUTOMATION_ROUTE.projectId}/${AUTOMATION_ROUTE.automationId}/edit`;
    await clickAndExpectPath(
      "Open direct edit",
      getPluginPanelRoutePath({
        pluginId: AUTOMATIONS_PLUGIN_ID,
        path: AUTOMATIONS_PLUGIN_PANEL_PATH,
        subPath: editSubPath,
      }),
    );
  });
});
