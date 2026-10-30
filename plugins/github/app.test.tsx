// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { fireEvent } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

const app = await loadPluginApp(() => import("./app"));

const GITHUB_TAB = {
  id: "pull",
  context: { kind: "thread" },
  availability: "action",
} as const;

function threadPanelAction(id: string) {
  const action = app.threadPanelActions.find((entry) => entry.id === id);
  if (action === undefined) throw new Error(`no "${id}" thread panel action`);
  return action;
}

function pullDetail(
  overrides: { number?: number; title?: string; files?: unknown[] } = {},
) {
  const number = overrides.number ?? 42;
  return {
    repo: "get-bb/bb",
    number,
    title: overrides.title ?? "Navigation fix",
    state: "OPEN",
    author: "octocat",
    body: "",
    url: `https://github.com/get-bb/bb/pull/${number}`,
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
    files: overrides.files ?? [],
  };
}

function requestedNumber(input: unknown): number {
  if (
    typeof input === "object" &&
    input !== null &&
    "number" in input &&
    typeof input.number === "number"
  ) {
    return input.number;
  }
  throw new Error("expected an item request");
}

function requestedKind(input: unknown): unknown {
  return typeof input === "object" && input !== null && "kind" in input
    ? input.kind
    : undefined;
}

function issueDetail(number: number, title: string) {
  return {
    repo: "get-bb/bb",
    number,
    title,
    state: "OPEN",
    author: "octocat",
    body: "",
    labels: [],
    assignees: [],
    url: `https://github.com/get-bb/bb/issues/${number}`,
    updatedAt: "2026-08-20T00:00:00.000Z",
    comments: [],
  };
}

describe("GitHub app navigation", () => {
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

  it("keeps removed pull-request files out of live workspace navigation", async () => {
    const slot = renderSlot(
      threadPanelAction("pull"),
      {
        threadId: "thr-1",
        environment: null,
        params: { repo: "get-bb/bb", number: 42 },
      },
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
            pull: pullDetail({
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
            }),
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

describe("GitHub links opened from a thread", () => {
  it.each([
    {
      href: "https://github.com/get-bb/bb/pull/42",
      claim: { title: "PR #42", params: { repo: "get-bb/bb", number: 42 } },
    },
    {
      href: "https://www.github.com/get-bb/bb/pull/42/?notification_referrer_id=1",
      claim: { title: "PR #42", params: { repo: "get-bb/bb", number: 42 } },
    },
    {
      href: "https://github.com/get-bb/bb/issues/7",
      claim: {
        title: "Issue #7",
        params: { kind: "issue", repo: "get-bb/bb", number: 7 },
      },
    },
    {
      href: "https://github.com/Get-BB/BB/pull/42",
      claim: { title: "PR #42", params: { repo: "get-bb/bb", number: 42 } },
    },
    { href: "https://github.com/get-bb/bb/pull/42/files", claim: null },
    {
      href: "https://github.com/get-bb/bb/issues/7#issuecomment-1",
      claim: null,
    },
    { href: "https://github.com/get-bb/bb/pulls", claim: null },
    { href: "https://github.com/get-bb/bb/issues/new", claim: null },
    { href: "https://github.com/get-bb/bb/pull/0", claim: null },
    { href: "https://github.com/get-bb/bb/blob/main/pull/42", claim: null },
    { href: "https://github.example.com/get-bb/bb/pull/42", claim: null },
  ])("the GitHub tab claims $href as $claim", ({ href, claim }) => {
    const tab = app.tabs.find((entry) => entry.id === "pull");
    expect(tab?.experimental_claimUrl?.(new URL(href))).toEqual(claim);
  });

  it("offers one GitHub tab in the + menu for pull requests and issues", () => {
    expect(
      app.tabs
        .filter(
          (entry) =>
            entry.context.kind === "thread" && entry.availability === "action",
        )
        .map((entry) => [entry.id, entry.title]),
    ).toEqual([["pull", "GitHub"]]);
  });

  it("shows the linked pull request rather than the thread's own, outside its workspace", async () => {
    const slot = renderSlot(
      threadPanelAction("pull"),
      {
        threadId: "thr-1",
        environment: null,
        params: { repo: "get-bb/bb", number: 7 },
      },
      {
        rpc: {
          pullForThread: () => ({
            pull: { repo: "get-bb/bb", number: 42, environmentId: "env-1" },
          }),
          getPull: (input) => {
            const number = requestedNumber(input);
            return {
              pull: pullDetail({
                number,
                title: number === 7 ? "Linked PR" : "Thread PR",
                files: [
                  {
                    path: "modified.ts",
                    status: "modified",
                    additions: 1,
                    deletions: 0,
                    patch: "@@ -0,0 +1 @@\n+added",
                  },
                ],
              }),
            };
          },
          listLinks: () => ({ links: {} }),
        },
      },
    );

    expect(await slot.findByText("Linked PR")).toBeTruthy();
    expect(slot.queryByText("Thread PR")).toBeNull();
    expect(slot.queryByText(/All PRs/)).toBeNull();
    await act(async () => {});
    expect(slot.getByText("modified.ts").closest("a")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("shows the agent linked to a pull request whatever the case of its repository", async () => {
    const slot = renderSlot(
      threadPanelAction("pull"),
      {
        threadId: "thr-1",
        environment: null,
        params: { repo: "get-bb/bb", number: 7 },
      },
      {
        rpc: {
          pullForThread: () => ({ pull: null }),
          getPull: () => ({ pull: pullDetail({ number: 7 }) }),
          listLinks: () => ({
            links: {
              "pr:Get-BB/BB#7": [
                {
                  kind: "pr",
                  repo: "Get-BB/BB",
                  number: 7,
                  threadId: "thr-agent",
                  createdAt: "2026-08-20T00:00:00.000Z",
                },
              ],
            },
          }),
        },
      },
    );

    expect(await slot.findByTitle("Open BB thread thr-agent")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it.each([
    ["takes its place", true, null],
    ["shows it inline when bb declines", false, "Thread PR"],
  ])(
    "a tab opened without params finds this thread's pull request and %s",
    async (_name, accepted, inlineTitle) => {
      const slot = renderSlot(
        threadPanelAction("pull"),
        { threadId: "thr-1", environment: null, params: null },
        {
          rpc: {
            pullForThread: () => ({
              pull: { repo: "get-bb/bb", number: 42, environmentId: "env-1" },
            }),
            getPull: () => ({ pull: pullDetail({ title: "Thread PR" }) }),
            listLinks: () => ({ links: {} }),
          },
          experimental_panel: { openTab: () => accepted },
        },
      );

      await act(async () => {});
      expect(slot.experimental_panelCalls).toEqual([
        {
          method: "openTab",
          options: {
            tab: GITHUB_TAB,
            title: "PR #42",
            params: { repo: "get-bb/bb", number: 42 },
            experimental_replace: true,
          },
        },
      ]);
      if (inlineTitle === null) {
        expect(slot.queryByText("Thread PR")).toBeNull();
      } else {
        expect(await slot.findByText(inlineTitle)).toBeTruthy();
      }
      slot.lifecycle.unmount();
    },
  );

  it("replaces the tab with the pull request picked in it", async () => {
    const slot = renderSlot(
      threadPanelAction("pull"),
      { threadId: "thr-1", environment: null, params: null },
      {
        rpc: {
          pullForThread: () => ({ pull: null }),
          listItems: () => ({
            items: [
              {
                repo: "get-bb/bb",
                number: 9,
                kind: "pr",
                title: "Open PR",
                state: "OPEN",
                author: "octocat",
                labels: [],
                assignees: [],
                url: "https://github.com/get-bb/bb/pull/9",
                body: "",
                updatedAt: "2026-08-20T00:00:00.000Z",
              },
            ],
          }),
          listLinks: () => ({ links: {} }),
        },
        experimental_panel: { openTab: () => true },
      },
    );

    const openPull = await slot.findByText("Open PR");
    await act(async () => openPull.click());
    expect(slot.experimental_panelCalls).toEqual([
      {
        method: "openTab",
        options: {
          tab: GITHUB_TAB,
          title: "PR #9",
          params: { repo: "get-bb/bb", number: 9 },
          experimental_replace: true,
        },
      },
    ]);
    slot.lifecycle.unmount();
  });

  it("shows the linked issue, and offers open issues beside pull requests when opened without one", async () => {
    const getIssue = vi.fn((input: unknown) => {
      const number = requestedNumber(input);
      return { issue: issueDetail(number, `Issue ${number}`) };
    });
    const rpc = {
      getIssue,
      pullForThread: () => ({ pull: null }),
      listItems: (input: unknown) => {
        const isIssue = requestedKind(input) === "issue";
        return {
          items: [
            {
              repo: "get-bb/bb",
              number: isIssue ? 9 : 42,
              kind: isIssue ? "issue" : "pr",
              title: isIssue ? "Open issue" : "Open PR",
              state: "OPEN",
              author: "octocat",
              labels: [],
              assignees: [],
              url: "https://github.com/get-bb/bb/issues/9",
              body: "",
              updatedAt: "2026-08-20T00:00:00.000Z",
            },
          ],
        };
      },
      listLinks: () => ({ links: {} }),
    };

    const linked = renderSlot(
      threadPanelAction("pull"),
      {
        threadId: "thr-1",
        environment: null,
        params: { kind: "issue", repo: "get-bb/bb", number: 7 },
      },
      { rpc },
    );
    expect(await linked.findByText("Issue 7")).toBeTruthy();
    linked.lifecycle.unmount();

    const picker = renderSlot(
      threadPanelAction("pull"),
      { threadId: "thr-1", environment: null, params: null },
      { rpc },
    );
    expect(await picker.findByText("Open PR")).toBeTruthy();
    const issuesTab = picker.getByRole("tab", { name: "Issues" });
    await act(async () => fireEvent.mouseDown(issuesTab));
    const openIssue = await picker.findByText("Open issue");
    expect(picker.queryByText("Open PR")).toBeNull();
    await act(async () => openIssue.click());
    expect(await picker.findByText("Issue 9")).toBeTruthy();
    const back = picker.getByText("← Issues");
    await act(async () => back.click());
    expect(await picker.findByText("Open issue")).toBeTruthy();
    expect(getIssue.mock.calls).toEqual([
      [{ repo: "get-bb/bb", number: 7 }],
      [{ repo: "get-bb/bb", number: 9 }],
    ]);
    expect(picker.experimental_panelCalls).toEqual([
      {
        method: "openTab",
        options: {
          tab: GITHUB_TAB,
          title: "Issue #9",
          params: { kind: "issue", repo: "get-bb/bb", number: 9 },
          experimental_replace: true,
        },
      },
    ]);
    picker.lifecycle.unmount();
  });
});
