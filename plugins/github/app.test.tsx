// @vitest-environment jsdom

import { fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

class ResizeObserverStub implements ResizeObserver {
  observe: ResizeObserver["observe"] = vi.fn();
  unobserve: ResizeObserver["unobserve"] = vi.fn();
  disconnect: ResizeObserver["disconnect"] = vi.fn();
}

vi.stubGlobal("ResizeObserver", ResizeObserverStub);

afterEach(() => vi.useRealTimers());

const app = await loadPluginApp(() => import("./app"));

describe("GitHub app navigation", () => {
  it("debounces GitHub search and adds a keyboard-selected result to the composer", async () => {
    vi.useFakeTimers();
    const listItems = vi.fn(() => ({
      items: [
        {
          repo: "get-bb/bb",
          number: 694,
          kind: "pr" as const,
          title: "Accessible GitHub search",
          state: "OPEN",
          author: "octocat",
          labels: [],
          assignees: [],
          url: "https://github.com/get-bb/bb/pull/694",
          body: "",
          updatedAt: "2026-08-20T00:00:00.000Z",
        },
      ],
    }));
    const slot = renderSlot(
      app.newThreadPanelActions[0]!,
      { projectId: "proj-1", params: null },
      {
        composer: {
          text: "/slop-cop ",
          scope: { kind: "new-thread", projectId: "proj-1" },
        },
        rpc: { listItems },
      },
    );

    try {
      const input = slot.getByRole("combobox", {
        name: "Search GitHub issues and pull requests",
      });
      fireEvent.change(input, { target: { value: "accessible" } });
      expect(
        slot.getByRole("status", { name: "Searching GitHub" }),
      ).toBeTruthy();

      await act(async () => vi.advanceTimersByTimeAsync(249));
      expect(listItems).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(listItems).toHaveBeenCalledWith({
        query: "accessible",
        limit: 12,
      });
      expect(slot.getByText("Accessible GitHub search")).toBeTruthy();
      expect(slot.getByText("get-bb/bb")).toBeTruthy();
      expect(slot.getByText("#694")).toBeTruthy();
      expect(slot.getByText("open")).toBeTruthy();
      expect(slot.getByText("@octocat")).toBeTruthy();

      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(slot.composer.mentions).toEqual([
        {
          provider: "pr",
          id: "get-bb/bb#694",
          label: "get-bb/bb#694",
        },
      ]);
      expect(slot.composer.text).toBe("/slop-cop get-bb/bb#694 ");
    } finally {
      slot.lifecycle.unmount();
      vi.useRealTimers();
    }
  });

  it("shows a recoverable error and an actionable empty search state", async () => {
    vi.useFakeTimers();
    const listItems = vi
      .fn()
      .mockRejectedValueOnce(new Error("GitHub is unavailable"))
      .mockResolvedValueOnce({ items: [] });
    const slot = renderSlot(
      app.newThreadPanelActions[0]!,
      { projectId: null, params: null },
      { rpc: { listItems } },
    );

    try {
      fireEvent.change(
        slot.getByRole("combobox", {
          name: "Search GitHub issues and pull requests",
        }),
        { target: { value: "missing" } },
      );
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(slot.getByRole("alert").textContent).toContain(
        "GitHub search failed: GitHub is unavailable",
      );

      fireEvent.click(slot.getByRole("button", { name: "Try again" }));
      await act(async () => vi.advanceTimersByTimeAsync(250));
      expect(slot.getByRole("status").textContent).toContain(
        "No cached items match",
      );
    } finally {
      slot.lifecycle.unmount();
      vi.useRealTimers();
    }
  });

  it("opens issue details in the URL-backed page instead of a fixed tab", async () => {
    const panel = app.navPanels[0]!;
    expect(panel.fixedTabs).toBeUndefined();

    const slot = renderSlot(
      panel,
      { subPath: "issues" },
      {
        rpc: {
          listItems: () => ({
            items: [
              {
                repo: "get-bb/bb",
                number: 42,
                kind: "issue",
                title: "Route-backed issue",
                state: "OPEN",
                author: "octocat",
                labels: [],
                assignees: [],
                url: "https://github.com/get-bb/bb/issues/42",
                body: "",
                updatedAt: "2026-08-20T00:00:00.000Z",
              },
            ],
          }),
          listLinks: () => ({ links: {} }),
          status: () => ({
            ghOk: true,
            ghState: "ready",
            ghError: null,
            repos: [{ repo: "get-bb/bb", projectId: null }],
            lastSyncedAt: null,
          }),
          viewer: () => ({ login: "octocat" }),
        },
      },
    );

    (await slot.findByText("Route-backed issue")).click();
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "issues/get-bb/bb/42" },
    });
    slot.lifecycle.unmount();
  });

  it("uses the standard responsive page inset for the main panel", () => {
    const slot = renderSlot(
      app.navPanels[0]!,
      { subPath: "" },
      {
        rpc: {
          listItems: () => ({ items: [] }),
          status: () => ({
            ghOk: true,
            ghState: "ready",
            ghError: null,
            repos: [],
            lastSyncedAt: null,
          }),
          viewer: () => ({ login: "octocat" }),
        },
      },
    );

    expect(slot.container.firstElementChild?.className).toContain("p-4 md:p-5");
    expect(slot.container.firstElementChild?.className).not.toContain("p-3");
    slot.lifecycle.unmount();
  });

  it("keeps removed pull-request files out of live workspace navigation", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-1", params: null },
      {
        rpc: {
          pullForThread: () => ({
            pull: {
              repo: "get-bb/bb",
              number: 42,
              environmentId: "env-1",
            },
          }),
          getPull: () => ({
            pull: {
              repo: "get-bb/bb",
              number: 42,
              title: "Navigation fix",
              state: "OPEN",
              author: "octocat",
              body: "",
              url: "https://github.com/get-bb/bb/pull/42",
              createdAt: "2026-08-20T00:00:00.000Z",
              updatedAt: "2026-08-20T00:00:00.000Z",
              baseRefName: "main",
              headRefName: "fix-navigation",
              additions: 1,
              deletions: 1,
              changedFiles: 2,
              labels: [],
              assignees: [],
              reviewDecision: "",
              mergeStateStatus: "CLEAN",
              reviewRequests: [],
              checks: [],
              comments: [],
              reviews: [],
              reviewThreads: [],
              files: [
                {
                  path: "removed.ts",
                  status: "removed",
                  additions: 0,
                  deletions: 1,
                  patch: "@@ -1 +0,0 @@\n-removed",
                },
                {
                  path: "modified.ts",
                  status: "modified",
                  additions: 1,
                  deletions: 0,
                  patch: "@@ -0,0 +1 @@\n+added",
                },
              ],
            },
          }),
          listLinks: () => ({ links: {} }),
        },
      },
    );

    await act(async () => {});
    const removedFile = slot.getByText("removed.ts");
    const modifiedFile = slot.getByText("modified.ts");
    expect(removedFile.closest("a")).toBeNull();
    expect(modifiedFile.closest("a")?.getAttribute("href")).toBe(
      "./modified.ts",
    );

    const diffToggle = removedFile.parentElement?.querySelector("button");
    if (!(diffToggle instanceof HTMLButtonElement)) {
      throw new Error("removed file diff toggle was not rendered");
    }
    expect(diffToggle.getAttribute("aria-label")).toBe(
      "Expand removed.ts diff",
    );
    await act(async () => diffToggle.click());
    const diff = slot.getByTestId("bb-diff");
    expect(diff.getAttribute("data-path")).toBe("removed.ts");
    expect(diffToggle.getAttribute("aria-label")).toBe(
      "Collapse removed.ts diff",
    );
    slot.lifecycle.unmount();
  });
});
