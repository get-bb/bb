import { pluginUpdateJobsQueryKey } from "@/hooks/queries/query-keys";
// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import type { QueryClient } from "@tanstack/react-query";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
  type PluginUpdateState,
} from "@/hooks/queries/plugin-settings-queries";
import {
  getNotifications,
  resetNotificationStore,
} from "@/lib/notifications/notification-store";
import { UpdatePluginDialog } from "./UpdatePluginDialog";
import { makePluginListItem } from "@/test/fixtures/plugins";

function plugin(updateState: Partial<PluginUpdateState>): PluginListItem {
  return makePluginListItem({
    id: "linear",
    source: "npm:@example/linear@^1.6.0",
    rootDir: "/plugins/linear",
    version: "1.6.2",
    name: "Linear",
    provenance: "catalog",
    catalogEntryId: "linear",
    publisherLabel: "BB Community",
    sourceDisplay: "npm · @bb-plugins/linear · tracks compatible",
    updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, ...updateState },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const queryClients: QueryClient[] = [];

function createDialogTestHarness() {
  const harness = createQueryClientTestHarness();
  queryClients.push(harness.queryClient);
  const Wrapper = harness.wrapper;
  return {
    ...harness,
    wrapper: ({ children }: { children: import("react").ReactNode }) => (
      <MemoryRouter>
        <Wrapper>{children}</Wrapper>
      </MemoryRouter>
    ),
  };
}

afterEach(async () => {
  cleanup();
  try {
    await vi.waitFor(() => {
      expect(queryClients.every((client) => client.isMutating() === 0)).toBe(
        true,
      );
    });
  } finally {
    for (const client of queryClients.splice(0)) client.clear();
    resetNotificationStore();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  }
});

describe("UpdatePluginDialog", () => {
  it("always shows the rollback promise for a compatible update and keeps details collapsed", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { wrapper } = createDialogTestHarness();
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
    const { wrapper } = createDialogTestHarness();
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
      screen.getByText(
        "Keep using 1.6.2 and check again when a compatible plugin version is available.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText(/once this bb meets/i)).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Update" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("opens persisted failure details and retries an available update", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          job: {
            id: "update-1",
            pluginId: "linear",
            displayName: "Linear",
            state: "running",
            phase: "preparing",
          },
        },
        202,
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onOpenChange = vi.fn();
    const { wrapper } = createDialogTestHarness();
    const failedAt = new Date(2026, 6, 22).getTime();
    render(
      <UpdatePluginDialog
        plugin={plugin({
          availableVersion: "1.8.0",
          lastFailure: {
            version: "1.7.0",
            at: failedAt,
            detail: "factory threw during activation",
          },
        })}
        open
        onOpenChange={onOpenChange}
      />,
      { wrapper },
    );

    expect(screen.getByRole("heading", { name: "Update failed" })).toBeTruthy();
    expect(screen.getByText("Failed on Jul 22, 2026.")).toBeTruthy();
    expect(
      screen.getByText(
        "bb couldn’t activate 1.7.0. It restored 1.6.2 and its data.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("factory threw during activation")).toBeTruthy();

    fireEvent.click(
      screen.getByRole("button", { name: "Retry update to 1.8.0" }),
    );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps a persisted failure actionable without offering an unavailable retry", () => {
    vi.stubGlobal("fetch", vi.fn());
    const { wrapper } = createDialogTestHarness();
    render(
      <UpdatePluginDialog
        plugin={plugin({
          lastFailure: {
            version: "1.7.0",
            at: null,
            detail: "factory threw during activation",
          },
        })}
        open
        onOpenChange={() => {}}
      />,
      { wrapper },
    );

    expect(screen.getByText(/Try again when a compatible update/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Retry update/ })).toBeNull();
  });

  it("closes on job acceptance without waiting for the update to finish", async () => {
    const job = {
      id: "update-1",
      pluginId: "linear",
      displayName: "Linear",
      state: "running",
      phase: "checking",
    };
    const fetchMock = vi.fn(async () => jsonResponse({ job }, 202));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper, queryClient } = createDialogTestHarness();
    const onOpenChange = vi.fn();
    render(
      <UpdatePluginDialog
        plugin={plugin({ availableVersion: "1.7.0" })}
        open
        onOpenChange={onOpenChange}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Update" }));
    await vi.waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(queryClient.getQueryData(pluginUpdateJobsQueryKey())).toEqual([job]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getNotifications()).toHaveLength(0);
  });

  it("records one alert when an update request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: "plugin source is unavailable" }, 502),
      ),
    );
    const { wrapper } = createDialogTestHarness();
    render(
      <UpdatePluginDialog
        plugin={plugin({ availableVersion: "1.7.0" })}
        open
        onOpenChange={() => {}}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await vi.waitFor(() => {
      expect(getNotifications()).toHaveLength(1);
    });
    const notification = getNotifications()[0];
    expect(notification?.title).toBe("Plugin update failed");

    expect(notification?.description).toBe(
      "Linear — plugin source is unavailable",
    );
  });

  it("treats a malformed 2xx update response as an error, never success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ status: "ok" })),
    );
    const { wrapper } = createDialogTestHarness();
    render(
      <UpdatePluginDialog
        plugin={plugin({ availableVersion: "1.7.0" })}
        open
        onOpenChange={() => {}}
      />,
      { wrapper },
    );

    fireEvent.click(screen.getByRole("button", { name: "Update" }));

    await vi.waitFor(() => {
      expect(getNotifications()).toHaveLength(1);
    });
    expect(getNotifications()[0]?.title).toBe("Plugin update failed");

    await vi.waitFor(() => {
      expect(
        (screen.getByRole("button", { name: "Update" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
    });
    expect(screen.getByText("Update Linear to 1.7.0?")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Update failed" })).toBeNull();
  });
});
