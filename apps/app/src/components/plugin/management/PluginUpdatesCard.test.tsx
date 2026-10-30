// @vitest-environment jsdom

import { pluginUpdateJobsQueryKey } from "@/hooks/queries/query-keys";
import { MemoryRouter } from "react-router-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import {
  PluginDetailReleaseControl,
  PluginDetailReleaseStatus,
  pluginHasUpdateSurfaces,
} from "./PluginUpdatesCard";
import { makePluginListItem } from "@/test/fixtures/plugins";

function plugin(overrides: Partial<PluginListItem> = {}): PluginListItem {
  return makePluginListItem({
    id: "linear",
    source: "npm:@example/linear@^1.6.0",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    name: "Linear",
    sourceDisplay: "npm · @bb-plugins/linear · pinned",
    ...overrides,
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("pluginHasUpdateSurfaces", () => {
  it("hides update surfaces for bundled plugins regardless of provenance", () => {
    expect(
      pluginHasUpdateSurfaces(
        plugin({ provenance: "catalog", source: "builtin:github" }),
      ),
    ).toBe(false);
    expect(
      pluginHasUpdateSurfaces(
        plugin({ provenance: "builtin", source: "builtin:secrets" }),
      ),
    ).toBe(false);
    expect(pluginHasUpdateSurfaces(plugin({ provenance: "direct" }))).toBe(
      true,
    );
    expect(pluginHasUpdateSurfaces(plugin({ provenance: "catalog" }))).toBe(
      true,
    );
  });
});

describe("PluginDetailReleaseControl", () => {
  it("offers a compatible update as a compact release action", () => {
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginDetailReleaseControl
        plugin={plugin({
          updateState: {
            ...EMPTY_PLUGIN_UPDATE_STATE,
            availableVersion: "1.9.0",
            availableLabel: "1.9.0",
          },
        })}
      />,
      {
        wrapper: ({ children }) => (
          <MemoryRouter>{wrapper({ children })}</MemoryRouter>
        ),
      },
    );

    const update = screen.getByRole("button", {
      name: "Update Linear to 1.9.0",
    });
    expect(update).toBeTruthy();
    expect(update.querySelector('[data-icon="Download"]')).not.toBeNull();
    expect(screen.queryByText("Compatible with your bb.")).toBeNull();
  });

  it("shows a blocked update inline without a modal or disabled action", () => {
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginDetailReleaseStatus
        plugin={plugin({
          updateState: {
            ...EMPTY_PLUGIN_UPDATE_STATE,
            blockedVersion: "1.9.0",
            blockedLabel: "1.9.0",
            blockedReasons: ["requires bb >= 0.15"],
          },
        })}
      />,
      {
        wrapper: ({ children }) => (
          <MemoryRouter>{wrapper({ children })}</MemoryRouter>
        ),
      },
    );

    const blockedStatus = screen.getByRole("status", {
      name: "Update blocked",
    });
    expect(screen.queryByText("Update blocked")).toBeNull();
    expect(blockedStatus.textContent).toContain("Requires bb >= 0.15.");
    expect(blockedStatus.textContent).toContain("1.6.2 remains installed");
    expect(blockedStatus.textContent).toContain(
      "check again when a compatible plugin version is available",
    );
    expect(blockedStatus.textContent).not.toContain("Update bb");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("retries a failed update from the release action without opening a modal", async () => {
    let completeUpdate: (() => void) | undefined;
    const fetchMock = vi.fn(
      (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          completeUpdate = () =>
            resolve(
              new Response(
                JSON.stringify({
                  job: {
                    id: "retry-1",
                    pluginId: "linear",
                    displayName: "Linear",
                    kind: "update",
                    state: "running",
                    phase: "checking",
                  },
                }),
                {
                  status: 202,
                  headers: { "content-type": "application/json" },
                },
              ),
            );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper, queryClient } = createQueryClientTestHarness();
    render(
      <>
        <PluginDetailReleaseControl
          plugin={plugin({
            updateState: {
              ...EMPTY_PLUGIN_UPDATE_STATE,
              availableVersion: "1.9.0",
              availableLabel: "1.9.0",
              lastFailure: {
                version: "1.9.0",
                label: "1.9.0",
                at: null,
                detail: "The plugin failed to load.",
                restored: true,
              },
            },
          })}
        />
        <PluginDetailReleaseStatus
          plugin={plugin({
            updateState: {
              ...EMPTY_PLUGIN_UPDATE_STATE,
              availableVersion: "1.9.0",
              availableLabel: "1.9.0",
              lastFailure: {
                version: "1.9.0",
                label: "1.9.0",
                at: null,
                detail: "The plugin failed to load.",
                restored: true,
              },
            },
          })}
        />
      </>,
      {
        wrapper: ({ children }) => (
          <MemoryRouter>{wrapper({ children })}</MemoryRouter>
        ),
      },
    );

    const failedStatus = screen.getByRole("status", { name: "Update failed" });
    expect(screen.queryByText("Update failed")).toBeNull();
    expect(failedStatus.textContent).toContain(
      "bb couldn’t activate 1.9.0. It restored 1.6.2 and its data.",
    );
    expect(screen.queryByText("Technical details")).toBeNull();
    expect(screen.queryByText("The plugin failed to load.")).toBeNull();
    expect(failedStatus.querySelector("button")).toBeNull();
    const retry = screen.getByRole("button", {
      name: "Retry update to 1.9.0",
    });
    fireEvent.click(retry);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      expectedVersion: "1.9.0",
    });
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry).toHaveProperty("disabled", true);
    completeUpdate?.();
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("false"));
    expect(queryClient.getQueryData(pluginUpdateJobsQueryKey())).toEqual([
      {
        id: "retry-1",
        pluginId: "linear",
        displayName: "Linear",
        kind: "update",
        state: "running",
        phase: "checking",
      },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("PluginDetailReleaseStatus", () => {
  const outsideRange = {
    version: "0.7.0",
    display:
      "https://github.com/acme/bb-plugin-agent-board.git@v0.7.0 (a985e1d55233)",
    breaking: true,
    range: "^0.6.1",
  };

  function renderStatus(updateState: Partial<PluginListItem["updateState"]>) {
    const { wrapper } = createQueryClientTestHarness();
    render(
      <PluginDetailReleaseStatus
        plugin={plugin({
          updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, ...updateState },
        })}
      />,
      {
        wrapper: ({ children }) => (
          <MemoryRouter>{wrapper({ children })}</MemoryRouter>
        ),
      },
    );
  }

  it("names a newer release outside the installed range when nothing in range is newer", () => {
    renderStatus({ outcome: "current", outsideRange });

    expect(
      screen.getByRole("status", { name: "Newer release outside range" })
        .textContent,
    ).toBe(
      "0.7.0 is outside the installed range ^0.6.1 and may include breaking changes. Compatibility not checked.",
    );
  });

  it("leaves the out-of-range release out while an in-range update is offered", () => {
    renderStatus({
      outcome: "update-available",
      availableVersion: "0.6.2",
      availableLabel: "0.6.2",
      outsideRange,
    });

    expect(
      screen.queryByRole("status", { name: "Newer release outside range" }),
    ).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("0.6.2Available");
  });

  it("explains why a current plugin was not moved to the release its source names", () => {
    renderStatus({
      outcome: "current",
      detail:
        'npm dist-tag "next" points to 1.0.0, older than the installed 1.6.2; bb does not downgrade',
    });

    expect(
      screen.getByRole("status", { name: "Update check note" }).textContent,
    ).toBe(
      'npm dist-tag "next" points to 1.0.0, older than the installed 1.6.2; bb does not downgrade',
    );
  });

  it("says bb kept a release it could not undo instead of claiming a restore", () => {
    renderStatus({
      lastFailure: {
        version: "1.6.2",
        label: "1.6.2",
        at: null,
        detail: "its saved host state is missing",
        restored: false,
      },
    });

    expect(
      screen.getByRole("status", { name: "Update failed" }).textContent,
    ).toBe(
      "bb couldn’t activate 1.6.2 or undo the change. It kept 1.6.2 and its data.",
    );
  });

  it("warns that an available release may break and names it by its label", () => {
    renderStatus({
      outcome: "update-available",
      availableVersion: "a985e1d5523398e9c7459d35679142cc4339771e",
      availableLabel: "2.0.0",
      availableDisplay:
        "https://github.com/acme/bb-plugin-linear.git@v2.0.0 (a985e1d55233)",
      availableBreaking: true,
    });

    expect(screen.getByRole("status").textContent).toBe(
      "2.0.0AvailableMay include breaking changes",
    );
  });
});
