// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import ResourcePaneView from "./ResourcePaneView";

vi.mock("@/views/ToolsView", () => ({
  PluginsView: () => <div>Plugins collection</div>,
  SkillsView: () => {
    const { skillId, registrySkillId } = useParams();
    const location = useLocation();
    return (
      <output>{`${location.pathname}${location.search} ${skillId ?? registrySkillId ?? "collection"}`}</output>
    );
  },
}));

afterEach(cleanup);

it.each([
  ["/skills?view=library", "/skills", "/skills?view=library collection"],
  ["/skills/library/demo", "/skills/library/demo", "/skills/library/demo demo"],
  [
    "/skills/registry/owner%2Fskill",
    "/skills/registry/owner%2Fskill",
    "/skills/registry/owner%2Fskill owner/skill",
  ],
])(
  "retains the resource route and parameters at %s",
  (entry, path, expected) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="*" element={<ResourcePaneView path={path} />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText(expected)).toBeTruthy();
  },
);

it("keeps an unfocused Skills pane on its own route beside Plugins", () => {
  render(
    <MemoryRouter initialEntries={["/plugins"]}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <ResourcePaneView path="/plugins" />
              <ResourcePaneView path="/skills/library/demo" />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  expect(screen.getByText("Plugins collection")).toBeTruthy();
  expect(screen.getByText("/skills/library/demo demo")).toBeTruthy();
});
