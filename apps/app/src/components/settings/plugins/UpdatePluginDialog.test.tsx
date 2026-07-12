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
    version: "1.6.2",
    enabled: true,
    status: "running",
    statusDetail: null,
    description: null,
    displayName: "Linear",
    icon: null,
    logoUrl: null,
    logoDarkUrl: null,
    hasSettings: false,
    provenance: "marketplace",
    marketplaceName: "bb-official",
    sourceDisplay: "npm · @bb-plugins/linear · tracking ^1.4.0",
    updatePolicy: "compatible",
    updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, ...updateState },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response;
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
    expect(
      screen.getByText("needs bb >= 0.15 — you have 0.14.1"),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Update" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("renders a rolled-back outcome in place, pointing at Needs attention", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
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

    expect(
      await screen.findByText("Update failed — rolled back"),
    ).toBeTruthy();
    expect(
      screen.getByText("factory threw during activation"),
    ).toBeTruthy();
    expect(screen.getByText(/Needs attention/)).toBeTruthy();
  });
});
