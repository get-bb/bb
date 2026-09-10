// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { AppRoutes } from "./App";

vi.mock("./components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./views/SettingsView", () => ({
  SettingsView: () => <h1>Settings</h1>,
}));
vi.mock("./views/ToolsView", () => ({
  PluginsView: ({ pluginId }: { pluginId?: string }) => (
    <h1>Plugin detail: {pluginId}</h1>
  ),
  SkillsView: () => <h1>Skills</h1>,
}));
vi.mock("./views/SplitWorkspaceRoute", () => ({
  default: () => <h1>App workspace</h1>,
}));

function HistoryBackButton() {
  const navigate = useNavigate();
  return <button onClick={() => navigate(-1)}>Back</button>;
}

function LocationPath() {
  const location = useLocation();
  return (
    <span>
      {location.pathname}
      {location.search}
      {location.hash}
    </span>
  );
}

afterEach(cleanup);

describe("legacy resource redirects", () => {
  it.each(["github", "plugin with spaces"])(
    "opens workspace installed detail for %s alongside Settings routes",
    async (pluginId) => {
      const settingsPath = `/settings/plugins/${encodeURIComponent(pluginId)}`;
      render(
        <MemoryRouter
          initialEntries={[
            settingsPath,
            `/plugins/${encodeURIComponent(pluginId)}?view=installed&from=bookmark#details`,
          ]}
          initialIndex={1}
        >
          <AppRoutes />
          <LocationPath />
          <HistoryBackButton />
        </MemoryRouter>,
      );
      expect(
        await screen.findByRole("heading", {
          name: `Plugin detail: ${pluginId}`,
        }),
      ).toBeTruthy();
      expect(
        screen.getByText(
          `/plugins/${encodeURIComponent(pluginId)}?view=installed&from=bookmark#details`,
        ),
      ).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(
        await screen.findByRole("heading", { name: "Settings" }),
      ).toBeTruthy();
      expect(screen.getByText(settingsPath)).toBeTruthy();
    },
  );

  it.each([
    ["/settings/plugins", "/settings/plugins"],
    ["/extensions?view=installed#catalog", "/plugins?view=installed#catalog"],
    ["/extensions/plugins", "/plugins"],
    [
      "/extensions/plugins/browse?sort=name#catalog",
      "/plugins?sort=name#catalog",
    ],
    [
      "/extensions/plugins/browse/?sort=name#catalog",
      "/plugins?sort=name#catalog",
    ],
    [
      "/extensions/plugins/github?view=installed#configuration",
      "/plugins/github?view=installed#configuration",
    ],
    ["/extensions/skills", "/skills"],
    [
      "/extensions/skills/library/skill_abc123?source=local#details",
      "/skills/library/skill_abc123?source=local#details",
    ],
    [
      "/extensions/skills/installed/skill_abc123",
      "/skills/library/skill_abc123",
    ],
    ["/extensions/skills/registry", "/skills/registry"],
    [
      "/extensions/skills/registry/moss-skills%2Fmoss-notes",
      "/skills/registry/moss-skills%2Fmoss-notes",
    ],
    ["/tools", "/plugins"],
    ["/tools/plugins/browse", "/plugins"],
    ["/tools/plugins/browse/?sort=name#catalog", "/plugins?sort=name#catalog"],
    [
      "/tools/plugins/github?view=installed#configuration",
      "/plugins/github?view=installed#configuration",
    ],
    [
      "/tools/skills/installed/skill_abc123?source=local#details",
      "/skills/library/skill_abc123?source=local#details",
    ],
    ["/tools/automations", "/plugins/automations/automations"],
  ])("redirects %s to %s", async (entry, expected) => {
    render(
      <MemoryRouter initialEntries={[entry]}>
        <AppRoutes />
        <LocationPath />
      </MemoryRouter>,
    );

    expect(await screen.findByText(expected)).toBeTruthy();
  });
});
