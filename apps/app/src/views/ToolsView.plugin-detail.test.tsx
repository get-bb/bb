// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    const onDelete = vi.fn();
    render(
      <MemoryRouter>
        <QueryClientWrapper>
          <PluginDetail
            isLoading={false}
            plugin={GITHUB_PLUGIN}
            pending={false}
            openSourceDisabled
            onToggle={() => {}}
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={onDelete}
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

    const installed = screen.getByRole("button", {
      name: "Uninstall GitHub",
    });
    expect(installed.textContent).toContain("Installed");
    expect(installed.textContent).toContain("Uninstall");
    fireEvent.click(installed);
    expect(onDelete).toHaveBeenCalledWith(GITHUB_PLUGIN);
    expect(screen.queryByRole("button", { name: "GitHub actions" })).toBeNull();
  });

  it("shows built-in provenance with lifecycle controls and no ownership actions", async () => {
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
            onEdit={() => {}}
            onOpenSource={() => {}}
            onDelete={() => {}}
          />
        </QueryClientWrapper>
      </MemoryRouter>,
    );

    const builtIn = screen.getByLabelText("Automations: Built-in");
    expect(builtIn.className).toContain("bg-surface-recessed/75");
    fireEvent.pointerMove(builtIn);
    expect((await screen.findByRole("tooltip")).textContent).toBe(
      "Ships with bb",
    );
    expect(
      screen.getByRole("switch", { name: "Disable Automations" }),
    ).toBeTruthy();

    expect(
      screen.queryByRole("button", { name: "Automations actions" }),
    ).toBeNull();
  });
});
