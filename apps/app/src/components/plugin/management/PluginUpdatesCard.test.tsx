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

  it("offers a release outside the saved range for review and never one that cannot run here", () => {
    const rangeUpgrade = {
      currentRange: "^1.6.0",
      range: "^2.0.0",
      basis: "catalog" as const,
      candidate: { version: "2.0.0", label: "2.0.0", display: "2.0.0" },
      breaking: true,
      reasons: [],
    };
    const wrapper = ({ children }: { children: import("react").ReactNode }) => (
      <MemoryRouter>
        {createQueryClientTestHarness().wrapper({ children })}
      </MemoryRouter>
    );
    const offered = plugin({
      updateState: {
        ...EMPTY_PLUGIN_UPDATE_STATE,
        outcome: "current",
        rangeUpgrade,
      },
    });
    render(
      <>
        <PluginDetailReleaseControl plugin={offered} />
        <PluginDetailReleaseStatus plugin={offered} />
      </>,
      { wrapper },
    );

    expect(
      screen.getByRole("button", {
        name: "Review the update of Linear to 2.0.0",
      }),
    ).toBeTruthy();
    expect(
      screen.getByRole("status", { name: "Update outside the version range" })
        .textContent,
    ).toBe(
      "2.0.0 is available outside the version range ^1.6.0 this plugin follows. The marketplace now lists ^2.0.0. It may include breaking changes, so bb won’t install it until you review it.",
    );

    cleanup();
    const blocked = plugin({
      updateState: {
        ...EMPTY_PLUGIN_UPDATE_STATE,
        outcome: "current",
        rangeUpgrade: { ...rangeUpgrade, reasons: ["requires bb >= 9"] },
      },
    });
    render(
      <>
        <PluginDetailReleaseControl plugin={blocked} />
        <PluginDetailReleaseStatus plugin={blocked} />
      </>,
      { wrapper },
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(
      screen.getByRole("status", { name: "Update outside the version range" })
        .textContent,
    ).toContain("Requires bb >= 9. 1.6.2 remains installed.");
  });

  it("reviews and confirms a range upgrade after a historical activation failure", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          job: {
            id: "range-update",
            pluginId: "linear",
            displayName: "Linear",
            state: "running",
            phase: "preparing",
          },
        },
        { status: 202 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = createQueryClientTestHarness();
    const failedThenOffered = plugin({
      version: "3.4.1",
      source: "npm:@example/linear@^3.4.0",
      provenance: "catalog",
      updateState: {
        ...EMPTY_PLUGIN_UPDATE_STATE,
        outcome: "current",
        lastFailure: {
          version: "4.0.0",
          label: "4.0.0",
          at: null,
          detail: "Activation failed and the previous version was restored.",
        },
        rangeUpgrade: {
          currentRange: "^3.4.0",
          range: "^4.0.0",
          basis: "catalog",
          candidate: {
            version: "4.2.0",
            label: "4.2.0",
            display: "4.2.0",
          },
          breaking: true,
          reasons: [],
        },
      },
    });
    render(
      <>
        <PluginDetailReleaseControl plugin={failedThenOffered} />
        <PluginDetailReleaseStatus plugin={failedThenOffered} />
      </>,
      {
        wrapper: ({ children }) => (
          <MemoryRouter>{wrapper({ children })}</MemoryRouter>
        ),
      },
    );

    expect(
      screen.getByRole("status", { name: "Update failed" }).textContent,
    ).toContain("bb couldn’t activate 4.0.0.");
    expect(
      screen.getByRole("status", { name: "Update outside the version range" })
        .textContent,
    ).toContain("4.2.0 is available outside the version range ^3.4.0");

    fireEvent.click(
      screen.getByRole("button", {
        name: "Review the update of Linear to 4.2.0",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Update Linear to 4.2.0?" }),
    ).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Update to 4.2.0" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(
      JSON.stringify({ range: "^4.0.0", expectedVersion: "4.2.0" }),
    );
  });

  it("retries a failed update from the release action without opening a modal", async () => {
    let completeUpdate: (() => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          completeUpdate = () =>
            resolve(
              new Response(
                JSON.stringify({
                  job: {
                    id: "retry-1",
                    pluginId: "linear",
                    displayName: "Linear",
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
    expect(retry.getAttribute("aria-busy")).toBe("true");
    expect(retry).toHaveProperty("disabled", true);
    completeUpdate?.();
    await waitFor(() => expect(retry.getAttribute("aria-busy")).toBe("false"));
    expect(queryClient.getQueryData(pluginUpdateJobsQueryKey())).toEqual([
      {
        id: "retry-1",
        pluginId: "linear",
        displayName: "Linear",
        state: "running",
        phase: "checking",
      },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
