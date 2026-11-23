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
import { SidebarHistoryNavigationControls } from "@/components/sidebar/SidebarHistoryNavigationControls";
import { getSkillDetailRoutePath } from "./route-paths";
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
      <button type="button" onClick={() => void navigate("/")}>
        go-home
      </button>
      {mounted ? <SidebarHistoryNavigationControls /> : null}
      {TOOL_ROUTE_SEQUENCE.map((path) => (
        <button key={path} type="button" onClick={() => void navigate(path)}>
          {path}
        </button>
      ))}
    </div>
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
});
