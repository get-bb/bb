// @vitest-environment jsdom
import { cleanup, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
} from "@get-bb/plugin-sdk/testing/app";
import type { githubRpcContract } from "./server.js";

const app = await loadPluginApp(() => import("./app"));
const panel = app.navPanels[0]!;

// jsdom has no matchMedia; @bb/shared-ui's responsive overlays query it.
beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
  // The panel persists its filter; start every case from the default is:open.
  window.localStorage.clear();
});

afterEach(cleanup);

const REPOS = [
  { repo: "acme/widgets", projectId: "p_aurora", projectName: "Aurora" },
  { repo: "acme/api", projectId: "p_nimbus", projectName: "Nimbus" },
  // Tracked through the extraRepos setting: no BB project at all.
  { repo: "acme/legacy", projectId: null, projectName: null },
];

function item(
  kind: "issue" | "pr",
  repo: string,
  number: number,
  title: string,
  updatedAt: string,
) {
  return {
    repo,
    number,
    kind,
    title,
    state: "OPEN",
    author: "octocat",
    labels: [],
    // Assigned, so the only em dash on screen is the project cell's.
    assignees: ["octocat"],
    url: `https://github.com/${repo}/pull/${number}`,
    body: "",
    updatedAt,
  };
}

// The cache returns newest-updated first, across every tracked repo.
const PULLS = [
  item("pr", "acme/widgets", 10, "Widget polish", "2026-08-19T00:00:00Z"),
  item("pr", "acme/legacy", 9, "Legacy shim", "2026-08-18T00:00:00Z"),
  item("pr", "acme/api", 8, "Api newer", "2026-08-17T00:00:00Z"),
  item("pr", "acme/api", 7, "Api older", "2026-08-16T00:00:00Z"),
];

type PanelRpc = PluginRpcTestHandlers<
  Pick<
    typeof githubRpcContract,
    "status" | "listItems" | "listLinks" | "viewer"
  >
>;

function rpcHandlers(items: ReturnType<typeof item>[]): PanelRpc {
  return {
    status: () => ({
      ghOk: true,
      ghState: "ready",
      ghError: null,
      repos: REPOS,
      lastSyncedAt: "2026-08-19T00:00:00Z",
    }),
    listItems: () => ({ items }),
    listLinks: () => ({ links: {} }),
    viewer: () => ({ login: "octocat" }),
  };
}

/** Where each needle first appears in the rendered text, in render order. */
function positions(container: HTMLElement, needles: string[]): number[] {
  const text = container.textContent ?? "";
  return needles.map((needle) => {
    const at = text.indexOf(needle);
    expect(at, `"${needle}" is not rendered`).toBeGreaterThanOrEqual(0);
    return at;
  });
}

describe("pull request table", () => {
  it("groups rows by project name and keeps project-less repos last", async () => {
    const slot = renderSlot(
      panel,
      { subPath: "pulls" },
      { rpc: rpcHandlers(PULLS) },
    );

    await waitFor(() => expect(slot.getByText("Widget polish")).toBeDefined());
    expect(slot.getByText("Project")).toBeDefined();

    // Aurora before Nimbus; inside Nimbus the cache's newest-first order
    // survives; the repo with no project sorts after both projects.
    const order = positions(slot.container, [
      "Widget polish",
      "Api newer",
      "Api older",
      "Legacy shim",
    ]);
    expect(order).toEqual([...order].sort((left, right) => left - right));
  });

  it("labels each row with its repo's project, em dash when there is none", async () => {
    const slot = renderSlot(
      panel,
      { subPath: "pulls" },
      { rpc: rpcHandlers(PULLS) },
    );

    await waitFor(() => expect(slot.getByText("Widget polish")).toBeDefined());
    expect(slot.getAllByText("Aurora")).toHaveLength(1);
    expect(slot.getAllByText("Nimbus")).toHaveLength(2);
    expect(slot.getAllByText("—")).toHaveLength(1);
  });

  it("leaves the issue table without a project column", async () => {
    const slot = renderSlot(
      panel,
      { subPath: "issues" },
      {
        rpc: rpcHandlers([
          item(
            "issue",
            "acme/widgets",
            4,
            "Widget bug",
            "2026-08-19T00:00:00Z",
          ),
        ]),
      },
    );

    await waitFor(() => expect(slot.getByText("Widget bug")).toBeDefined());
    expect(slot.queryByText("Project")).toBeNull();
    expect(slot.queryByText("Aurora")).toBeNull();
  });
});
