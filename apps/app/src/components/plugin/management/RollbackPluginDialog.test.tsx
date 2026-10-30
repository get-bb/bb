// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  EMPTY_PLUGIN_UPDATE_STATE,
  type PluginListItem,
} from "@/hooks/queries/plugin-settings-queries";
import { pluginUpdateJobsQueryKey } from "@/hooks/queries/query-keys";
import {
  getNotifications,
  resetNotificationStore,
} from "@/lib/notifications/notification-store";
import { makePluginListItem } from "@/test/fixtures/plugins";
import { formatAbsoluteDate } from "./plugin-ui";
import { PluginDetailRollback } from "./RollbackPluginDialog";

const commit = "a985e1d5523398e9c7459d35679142cc4339771e";
const until = new Date(2026, 9, 28).getTime();
const rollback = {
  version: commit,
  label: "1.6.2",
  display: `https://github.com/acme/bb-plugin-linear.git@v1.6.2 (${commit.slice(0, 12)})`,
  until,
};

function plugin(): PluginListItem {
  return makePluginListItem({
    id: "linear",
    source: "git:https://github.com/acme/bb-plugin-linear.git@semver:^1.6.0",
    rootDir: "/plugins/linear",
    version: "1.7.0",
    name: "Linear",
    provenance: "direct",
    sourceDisplay: "git · acme/bb-plugin-linear · ^1.6.0",
    updateState: { ...EMPTY_PLUGIN_UPDATE_STATE, rollback },
  });
}

const queryClients: QueryClient[] = [];

function renderRollback() {
  const harness = createQueryClientTestHarness();
  queryClients.push(harness.queryClient);
  const Wrapper = harness.wrapper;
  render(<PluginDetailRollback plugin={plugin()} />, {
    wrapper: ({ children }) => (
      <MemoryRouter>
        <Wrapper>{children}</Wrapper>
      </MemoryRouter>
    ),
  });
  return harness;
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

describe("PluginDetailRollback", () => {
  it("names the kept release and its deadline, and warns before rolling back", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderRollback();

    expect(screen.getByText(/You can return to it until/u).textContent).toBe(
      `The last update replaced 1.6.2. You can return to it until ${formatAbsoluteDate(until)}.`,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Roll back to 1.6.2" }));

    expect(
      screen.getByRole("heading", { name: "Roll back Linear to 1.6.2?" }),
    ).toBeTruthy();
    expect(
      screen.getByText(
        `Currently 1.7.0. Available until ${formatAbsoluteDate(until)}.`,
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(
        "Linear’s settings, stored data, secrets, and schedules go back to how they were before the update to 1.7.0. Changes made since then are discarded.",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("rollback-note").textContent).toContain(
      "if 1.6.2 fails to start, bb restores 1.7.0 and its data automatically",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rolls back only the shown release and closes once the job starts", async () => {
    const job = {
      id: "rollback-1",
      pluginId: "linear",
      displayName: "Linear",
      kind: "rollback",
      state: "running",
      phase: "activating",
    };
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ job }, { status: 202 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { queryClient } = renderRollback();

    fireEvent.click(screen.getByRole("button", { name: "Roll back to 1.6.2" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));

    await vi.waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [input, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(input)).toBe("/api/v1/plugins/linear/rollback");
    expect(new Headers(init?.headers).get("prefer")).toBe("respond-async");
    expect(JSON.parse(String(init?.body))).toEqual({ expectedVersion: commit });
    expect(queryClient.getQueryData(pluginUpdateJobsQueryKey())).toEqual([job]);
    expect(getNotifications()).toHaveLength(0);
  });

  it("records one alert and keeps the dialog open when the rollback cannot start", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("404 Not Found", { status: 404 })),
    );
    renderRollback();

    fireEvent.click(screen.getByRole("button", { name: "Roll back to 1.6.2" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll back" }));

    await vi.waitFor(() => expect(getNotifications()).toHaveLength(1));
    expect(getNotifications()[0]).toMatchObject({
      title: "Plugin rollback failed",
      description:
        "Linear — Rollback not started; this BB server predates plugin rollback. Upgrade the BB server to roll back an update",
    });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
