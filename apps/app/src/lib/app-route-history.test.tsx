// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
  getAutomationDetailRoutePath,
  getAutomationEditRoutePath,
  getAutomationsRoutePath,
  getSkillDetailRoutePath,
} from "./route-paths";
import { resetAppRouteHistoryForTest } from "./app-route-history";

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

function RemountableSidebarControlsHarness() {
  const [mounted, setMounted] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <div data-testid="path">{location.pathname}</div>
      <button type="button" onClick={() => setMounted((value) => !value)}>
        toggle-controls
      </button>
      <button type="button" onClick={() => navigate("/")}>
        go-home
      </button>
      {mounted ? <SidebarHistoryNavigationControls /> : null}
      {TOOL_ROUTE_SEQUENCE.map((path) => (
        <button key={path} type="button" onClick={() => navigate(path)}>
          {path}
        </button>
      ))}
    </div>
  );
}

const AUTOMATIONS_PLUGIN_PANEL_PATH = "automations";

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
      screen
        .getByRole("button", { name: label })
        .getAttribute("aria-disabled") === "true",
    ).toBe(disabled);
  });
}

describe("useRouteStateHistoryNavigation", () => {
  afterEach(() => {
    cleanup();
    resetAppRouteHistoryForTest();
  });

  it("keeps the sidebar arrows' stack when the controls remount across sidebar layouts", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <RemountableSidebarControlsHarness />
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

    fireEvent.click(screen.getByRole("button", { name: "toggle-controls" }));
    expect(screen.queryByRole("button", { name: "Go back" })).toBeNull();
    await clickAndExpectPath("go-home", "/");
    fireEvent.click(screen.getByRole("button", { name: "toggle-controls" }));

    await expectSidebarButtonState("Go back", false);
    await clickAndExpectPath("Go back", "/skills");
  });

  it("redirects remounted automation edit routes without duplicate history entries", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={[getAutomationsRoutePath()]}>
          <RemountablePluginNavigationHarness />
        </MemoryRouter>
      </QueryClientProvider>,
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
});
