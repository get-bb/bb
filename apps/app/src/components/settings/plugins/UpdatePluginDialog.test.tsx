// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  type PluginUpdateState,
} from "@/hooks/queries/plugin-settings-queries";
import { UpdatePluginDialog } from "./UpdatePluginDialog";

function plugin(updateState: Partial<PluginUpdateState>): PluginListItem {
  return {
    id: "linear",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    source: "npm:@example/linear@^1.6.0",
    name: "Linear",
    icon: null,
    compactIconUrl: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    handlerStats: { count: 0, totalMs: 0, maxMs: 0, errorCount: 0 },
    services: [],
    schedules: [],
    cliCommand: null,
    app: { hasApp: false, bundle: null },
    provenance: "catalog",
    isOrphanedBuiltin: false,
    catalogEntryId: "linear",
    sourceDisplay: "npm · @bb-plugins/linear · tracks compatible",
    updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, ...updateState },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("UpdatePluginDialog", () => {
  it("always shows the rollback promise for a compatible update and keeps details collapsed", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { wrapper } = createQueryClientTestHarness();
    render(
      <UpdatePluginDialog
        plugin={plugin({ availableVersion: "1.7.0" })}
        open
        onOpenChange={() => {}}
      />,
      { wrapper },
    );

    expect(screen.getByText("Update Linear to 1.7.0?")).toBeTruthy();
    expect(screen.getByTestId("rollback-note").textContent).toContain(
      "if 1.7.0 fails to start, bb restores 1.6.2",
    );
    expect(
      screen
        .getByRole("button", { name: /details — source/i })
        .getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("renders the incompatible variant pre-expanded with Update disabled", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { wrapper } = createQueryClientTestHarness();
    render(
      <UpdatePluginDialog
        plugin={plugin({
          blockedVersion: "1.9.0",
          blockedReasons: ["needs bb >= 0.15 — you have 0.14.1"],
        })}
        open
        onOpenChange={() => {}}
      />,
      { wrapper },
    );

    expect(
      screen.getByText("1.9.0 isn’t compatible with this bb"),
    ).toBeTruthy();
    expect(screen.getByText("needs bb >= 0.15 — you have 0.14.1")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Update" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders a rolled-back outcome in place, pointing at Needs attention", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        // The exact applyUpdate result shape from plugin-service.
        jsonResponse({
          applied: false,
          from: { version: "1.6.2", display: "1.6.2" },
          to: { version: "1.7.0", display: "1.7.0" },
          outcome: "rolled-back",
          detail: "factory threw during activation",
        }),
      ),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <UpdatePluginDialog
        plugin={plugin({ availableVersion: "1.7.0" })}
        open
        onOpenChange={() => {}}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    expect(await screen.findByText("Update failed — rolled back")).toBeTruthy();
    expect(screen.getByText("factory threw during activation")).toBeTruthy();
    expect(screen.getByText(/Needs attention/)).toBeTruthy();
  });

  it("treats a malformed 2xx update response as an error, never success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "ok" })),
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <UpdatePluginDialog
        plugin={plugin({ availableVersion: "1.7.0" })}
        open
        onOpenChange={() => {}}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    // The dialog neither closes as a success nor shows the rollback view —
    // the drifted response surfaces as an error and the confirmation stays.
    await vi.waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Update" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
    expect(screen.getByText("Update Linear to 1.7.0?")).toBeTruthy();
    expect(screen.queryByText("Update failed — rolled back")).toBeNull();
  });
});
