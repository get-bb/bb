// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { PluginDetail } from "./ToolsView";

const GITHUB_PLUGIN = {
  id: "github",
  source: "builtin:github",
  rootDir: "/managed/plugins/github",
  version: "0.1.0",
  enabled: true,
  status: "running",
  statusDetail: null,
  description: "Browse GitHub issues and pull requests in BB.",
  name: "GitHub",
  icon: "Github",
  compactIconUrl: null,
  logoUrl: null,
  logoDarkUrl: null,
  hasSettings: false,
  handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
  services: [],
  schedules: [],
  cliCommand: null,
  app: { hasApp: true, bundle: null },
  provenance: "catalog" as const,
  isOrphanedBuiltin: false,
  catalogEntryId: "github",
  sourceDisplay: "BB Official · GitHub",
  updateState: EMPTY_PLUGIN_UPDATE_STATE,
} satisfies PluginListItem;

afterEach(cleanup);

describe("PluginDetail official catalog lifecycle", () => {
  it("keeps catalog provenance and release management in the unified detail taxonomy", async () => {
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <QueryClientWrapper>
          <PluginDetail
            isLoading={false}
            plugin={GITHUB_PLUGIN}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onReload={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={() => {}}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    expect(screen.getByText("BB Official")).toBeTruthy();
    expect(screen.getByText("About")).toBeTruthy();
    expect(
      screen.getByText("Browse GitHub issues and pull requests in BB."),
    ).toBeTruthy();
    expect(screen.getByText("Release")).toBeTruthy();
    expect(screen.getByText("0.1.0")).toBeTruthy();
    expect(screen.getByText("Included with bb releases")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Check now" })).toBeNull();

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "GitHub actions" }),
      { button: 0 },
    );
    expect(
      await screen.findByRole("menuitem", { name: "Uninstall" }),
    ).toBeTruthy();
  });

  it("keeps Reload actionable for built-in plugins without exposing ownership actions", async () => {
    const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter>
        <QueryClientWrapper>
          <PluginDetail
            isLoading={false}
            plugin={{
              ...GITHUB_PLUGIN,
              id: "automations",
              name: "Automations",
              source: "builtin:automations",
              provenance: "builtin",
              catalogEntryId: null,
            }}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onReload={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={() => {}}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Automations actions" }),
      { button: 0 },
    );

    expect(
      await screen.findByRole("menuitem", { name: "Reload" }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Edit" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "Open source" })).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: /Remove|Uninstall/ }),
    ).toBeNull();
  });
});
