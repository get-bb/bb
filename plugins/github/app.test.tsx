// @vitest-environment jsdom

import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act } from "react";
import {
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { Toaster } from "sonner";
import {
  experimental_makePanelController,
  makeThreadResponse,
} from "@get-bb/plugin-sdk/testing";
import {
  loadPluginApp,
  renderSlot,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import type {
  PluginCommandContext,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { THREAD_PULL_COMMAND } from "./app";
import { setActivity } from "./components/pull-actions";
import { assemblePullStatus, type RawPullStatus } from "./pull-status";

const app = await loadPluginApp(() => import("./app"));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  for (const number of [1, 2, 3, 4, 5, 6, 42]) {
    setActivity(`get-bb/bb#${number}`, null);
  }
});

function pull(
  number: number,
  title: string,
  author: string,
  overrides: Partial<RawPullStatus> = {},
) {
  return {
    repo: "get-bb/bb",
    number,
    kind: "pr",
    title,
    state: "OPEN",
    author,
    labels: [],
    assignees: [],
    url: `https://github.com/get-bb/bb/pull/${number}`,
    body: "",
    updatedAt: "2026-08-20T00:00:00.000Z",
    pr: assemblePullStatus({
      state: "OPEN",
      isDraft: false,
      baseRefName: "main",
      headRefName: `branch-${number}`,
      headRefOid: `sha-${number}`,
      isCrossRepository: false,
      additions: 12,
      deletions: 3,
      changedFiles: 2,
      mergedAt: null,
      mergeable: "MERGEABLE",
      reviewDecision: null,
      isInMergeQueue: false,
      requestedReviewers: [],
      checkRunCounts: [{ state: "SUCCESS", count: 5 }],
      statusContextCounts: [],
      checksVerdict: null,
      stack: null,
      headOwner: "get-bb",
      ...overrides,
    }),
    snooze: null,
  };
}

function issue(number: number, title: string, state = "OPEN") {
  return {
    repo: "get-bb/bb",
    number,
    kind: "issue",
    title,
    state,
    author: "monalisa",
    labels: [],
    assignees: [] as string[],
    url: `https://github.com/get-bb/bb/issues/${number}`,
    body: "",
    updatedAt: "2026-08-20T00:00:00.000Z",
    pr: null,
    snooze: null,
  };
}

const FAILING = [
  { state: "FAILURE", count: 2 },
  { state: "SUCCESS", count: 3 },
];

const PULLS = [
  pull(1, "feat(list): Ship the inbox", "octocat"),
  pull(2, "Fix the flaky shard", "hubot", { checkRunCounts: FAILING }),
  pull(3, "Review me", "hubot", { requestedReviewers: ["octocat"] }),
  pull(4, "Still a draft", "octocat", { isDraft: true }),
  pull(5, "Build on the inbox", "hubot", { baseRefName: "branch-1" }),
  pull(6, "Fix my own shard", "octocat", { checkRunCounts: FAILING }),
];

const ISSUES = [
  issue(42, "Route-backed issue"),
  issue(41, "Old issue", "CLOSED"),
];

const STATUS = {
  ghOk: true,
  ghState: "ready",
  ghError: null,
  repos: [{ repo: "get-bb/bb", projectId: "project-1" }],
  lastSyncedAt: "2026-10-21T00:00:00.000Z",
  lastSyncError: null,
  defaultProjectId: null,
};

type Handler = (input: unknown) => unknown;

function field(input: unknown, key: string): unknown {
  return typeof input === "object" && input !== null
    ? Reflect.get(input, key)
    : undefined;
}

function rpc(overrides: Record<string, Handler> = {}): Record<string, Handler> {
  return {
    status: () => STATUS,
    viewer: () => ({ login: "octocat" }),
    listItems: (input) =>
      field(input, "kind") === "issue" ? { items: ISSUES } : { items: PULLS },
    listLinks: () => ({ links: {} }),
    repoSettings: () => ({
      repos: {
        "get-bb/bb": {
          viewerCanWrite: true,
          mergeMethods: ["squash", "merge"],
          defaultMergeMethod: "squash",
          deleteBranchOnMerge: false,
        },
      },
    }),
    mergePull: (input) => ({
      ok: true,
      method: field(input, "method"),
      deletedBranch: field(input, "deleteBranch") === true,
    }),
    setPullState: (input) => ({ ok: true, state: field(input, "state") }),
    snoozePull: (input) => ({
      ok: true,
      snooze: { rule: field(input, "rule"), until: null },
    }),
    unsnoozePull: () => ({ ok: true }),
    refresh: () => ({ repos: 1, items: PULLS.length }),
    ...overrides,
  };
}

function check(
  name: string,
  status: "success" | "failure" | "pending" | "skipped",
  runId: number | null = 7,
) {
  return {
    name,
    workflow: "CI",
    status,
    url: `https://github.com/get-bb/bb/actions/runs/${runId ?? 0}`,
    runId,
    completedAt: status === "pending" ? null : "2026-08-20T00:00:00.000Z",
    required: true,
  };
}

function pullDetail(overrides: Record<string, unknown> = {}) {
  return {
    repo: "get-bb/bb",
    number: 42,
    title: "Status menu",
    state: "OPEN",
    isDraft: false,
    author: "octocat",
    body: "",
    url: "https://github.com/get-bb/bb/pull/42",
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T00:00:00.000Z",
    baseRefName: "main",
    headRefName: "status-menu",
    additions: 1234,
    deletions: 56,
    changedFiles: 3,
    labels: [],
    assignees: [],
    reviewDecision: "",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
    reviewRequests: [],
    headRefOid: "abc123",
    isCrossRepository: false,
    isInMergeQueue: false,
    headCommittedAt: "2026-08-20T00:00:00.000Z",
    closedAt: null,
    mergedAt: null,
    mergedBy: null,
    viewerCanUpdate: true,
    viewerCanClose: true,
    viewerCanReopen: false,
    viewerCanMerge: true,
    viewerCanDeleteHeadRef: true,
    isMergeQueueEnabled: false,
    headRefExists: true,
    checksVerdict: null,
    mergeMethods: ["squash", "merge"],
    defaultMergeMethod: "squash",
    deleteBranchOnMerge: false,
    reviewVerdicts: [],
    events: [],
    stack: null,
    checks: [check("build", "success")],
    comments: [],
    reviews: [],
    reviewThreads: [],
    files: [],
    ...overrides,
  };
}

function sidebarThread(
  overrides: Partial<PluginSidebarThread> & { id: string },
): PluginSidebarThread {
  return {
    projectId: "project-1",
    title: "Fix · get-bb/bb#6",
    titleFallback: null,
    displayTitle: "Fix · get-bb/bb#6",
    parentThreadId: null,
    lifecycleOwnerThreadId: null,
    parentNotifications: "auto",
    sourceThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    status: "idle",
    runtimeStatus: "idle",
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: false,
    archivedAt: null,
    href: `/projects/project-1/threads/${overrides.id}`,
    isHidden: false,
    environment: null,
    host: null,
    createdAt: Date.parse("2026-10-21T00:00:00.000Z"),
    updatedAt: Date.parse("2026-10-21T00:00:00.000Z"),
    lastReadAt: null,
    latestAttentionAt: 1,
    ...overrides,
  };
}

function worktreeThread(projectId: string): PluginSidebarThread {
  return sidebarThread({
    id: "thr-worktree",
    projectId,
    environment: {
      id: "env-status-menu",
      name: "status-menu",
      branchName: "status-menu",
      path: null,
      isWorktree: true,
      providerId: null,
      workspaceDisplayKind: null,
    },
  });
}

function link(kind: "pr" | "issue", threadId: string, number: number) {
  return {
    kind,
    repo: "get-bb/bb",
    number,
    threadId,
    createdAt: "2026-10-21T00:00:00.000Z",
  };
}

function renderPanel(
  subPath = "pulls",
  overrides: Record<string, Handler> = {},
  options: Omit<RenderSlotOptions, "rpc"> = {},
) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath },
    { ...options, rpc: rpc(overrides) },
  );
}

function fakeGithub(
  initial: Record<string, unknown> = {},
  options: { canReopen?: boolean; failWith?: string } = {},
) {
  let detail = pullDetail(initial);
  return {
    getPull: () => ({ pull: detail }),
    setPullState: (input: unknown) => {
      if (options.failWith !== undefined) {
        return Promise.reject(new Error(options.failWith));
      }
      const target = field(input, "state");
      const closed = target === "closed";
      const isDraft =
        target === "draft" ? true : target === "open" ? false : detail.isDraft;
      detail = {
        ...detail,
        state: closed ? "CLOSED" : isDraft ? "DRAFT" : "OPEN",
        isDraft,
        viewerCanReopen: closed && (options.canReopen ?? true),
      };
      return { ok: true, state: target };
    },
  };
}

function renderPull(
  github: Record<string, Handler>,
  options: Omit<RenderSlotOptions, "rpc"> = {},
) {
  return renderPanel(
    "pulls/get-bb/bb/42",
    { listItems: () => ({ items: [] }), ...github },
    options,
  );
}

function calls(slot: ReturnType<typeof renderSlot>, method: string) {
  return slot.rpcCalls
    .filter((call) => call.method === method)
    .map((call) => call.input);
}

async function nextStepCard(
  slot: ReturnType<typeof renderSlot>,
  text: string,
): Promise<HTMLElement> {
  await waitFor(() =>
    expect(
      slot.getByRole("region", { name: "Next step" }).textContent,
    ).toContain(text),
  );
  return slot.getByRole("region", { name: "Next step" });
}

function regions(slot: ReturnType<typeof renderSlot>): Array<string | null> {
  return slot
    .getAllByRole("region")
    .map((region) => region.getAttribute("aria-label"));
}

function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
}

function stubScrollIntoView() {
  const scrollIntoView = vi.fn();
  const original = Object.getOwnPropertyDescriptor(
    Element.prototype,
    "scrollIntoView",
  );
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  onTestFinished(() => {
    if (original !== undefined) {
      Object.defineProperty(Element.prototype, "scrollIntoView", original);
    } else {
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
  return scrollIntoView;
}

function toaster() {
  const view = render(<Toaster />);
  onTestFinished(() => view.unmount());
  return view;
}

describe("GitHub pull request inbox", () => {
  it("says checks are failing on rows whose reason is something else", async () => {
    const slot = renderPanel("pulls/all", {
      listItems: () => ({
        items: [
          pull(7, "Review the shard fix", "hubot", {
            requestedReviewers: ["octocat"],
            checkRunCounts: FAILING,
          }),
          pull(8, "Rebase the shard fix", "hubot", {
            mergeable: "CONFLICTING",
            checkRunCounts: FAILING,
          }),
          pull(2, "Fix the flaky shard", "hubot", { checkRunCounts: FAILING }),
        ],
      }),
    });

    expect(
      await slot.findByRole("button", {
        name: "#7 Review the shard fix: Your review is requested · Checks failing",
      }),
    ).toBeTruthy();
    expect(
      slot.getByRole("button", {
        name: "#8 Rebase the shard fix: Merge conflicts · Checks failing",
      }),
    ).toBeTruthy();
    expect(
      slot.getByRole("button", {
        name: "#2 Fix the flaky shard: Checks failing",
      }),
    ).toBeTruthy();
  });

  it("keeps the inbox to what needs the viewer and says why in words", async () => {
    const slot = renderPanel();

    await slot.findByText("Ship the inbox");
    await act(async () => {});
    expect(regions(slot)).toEqual([
      "Your move",
      "Ready to merge",
      "Needs fixing",
    ]);
    const inboxTab = slot.getByRole("button", { name: /^Inbox/ });
    expect(inboxTab.textContent).toBe("Inbox3");
    expect(inboxTab.getAttribute("aria-current")).toBe("page");
    expect(slot.getByText("feat(list):")).toBeTruthy();
    expect(
      slot.getByRole("button", { name: "#6 Fix my own shard: Checks failing" }),
    ).toBeTruthy();
    expect(slot.queryByText("Fix the flaky shard")).toBeNull();
    expect(slot.queryByText("Build on the inbox")).toBeNull();
    expect(slot.queryByText("Still a draft")).toBeNull();
    expect(slot.queryByText(/\d+ checks? failing/)).toBeNull();

    await act(async () =>
      slot
        .getByRole("button", {
          name: "#3 Review me: Your review is requested",
        })
        .click(),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/get-bb/bb/3" },
    });

    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Mine" })),
    );
    expect(slot.navigateCalls.at(-1)).toEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/mine", replace: true },
    });
  });

  it("shows the viewer's drafts under Mine, collapsed until asked", async () => {
    const slot = renderPanel("pulls/mine");

    await slot.findByText("Ship the inbox");
    expect(slot.queryByText("Still a draft")).toBeNull();
    await act(async () =>
      slot.getByRole("button", { name: /^Drafts/ }).click(),
    );
    expect(slot.getByText("Still a draft")).toBeTruthy();
    expect(slot.queryByText("Review me")).toBeNull();
  });

  it("walks the rows with j and k, opens with Enter, and switches views with ] in place", async () => {
    const slot = renderPanel();
    await slot.findByText("Ship the inbox");
    await act(async () => {});

    await act(async () => press("j"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "#3 Review me: Your review is requested",
    );
    await act(async () => press("j"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "#1 feat(list): Ship the inbox: Checks passing",
    );
    await act(async () => press("k"));
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "#3 Review me: Your review is requested",
    );
    await act(async () => press("Enter"));
    expect(slot.navigateCalls.at(-1)).toEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/get-bb/bb/3" },
    });

    await act(async () => press("]"));
    expect(slot.navigateCalls.at(-1)).toEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/mine", replace: true },
    });
  });

  it("moves one pull request per j in split view while the route catches up", async () => {
    window.localStorage.setItem("bb-plugin-github:v4:tab", "all");
    const slot = renderPanel("pulls/get-bb/bb/3");
    await slot.findByText("Ship the inbox");
    await act(async () => {});
    const order = [...document.querySelectorAll("[data-row-key]")].map(
      (row) => row.getAttribute("data-row-key") ?? "",
    );
    const start = order.indexOf("get-bb/bb#3");
    expect(order.length - start).toBeGreaterThan(3);

    await act(async () => press("j"));
    await act(async () => press("j"));
    await act(async () => press("j"));
    expect(
      slot.navigateCalls.map((call) =>
        field(field(call, "options"), "subPath"),
      ),
    ).toEqual(
      order
        .slice(start + 1, start + 4)
        .map((key) => `pulls/${key.replace("#", "/")}`),
    );
    expect(
      document.activeElement
        ?.closest("[data-row-key]")
        ?.getAttribute("data-row-key"),
    ).toBe(order[start + 3]);
  });

  it("merges the cursor row with m through the same method menu as the row", async () => {
    const toasts = toaster();
    const slot = renderPanel();
    await slot.findByText("Ship the inbox");
    await act(async () => {});

    await act(async () => press("j"));
    await act(async () => press("j"));
    await act(async () => press("m"));
    expect(
      slot.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Squash merge", "Merge"]);
    const remove = slot.getByRole("menuitemcheckbox", {
      name: "Delete the branch",
    });
    expect(remove.getAttribute("aria-checked")).toBe("false");

    await act(async () =>
      fireEvent.click(slot.getByRole("menuitem", { name: "Squash merge" })),
    );
    expect(calls(slot, "mergePull")).toEqual([
      {
        repo: "get-bb/bb",
        number: 1,
        method: "squash",
        deleteBranch: false,
        headRefOid: "sha-1",
      },
    ]);
    await toasts.findByText("Squash-merged #1 into main");
    expect(
      slot.getByRole("button", {
        name: "#1 feat(list): Ship the inbox: Merged into main",
      }),
    ).toBeTruthy();
    expect(slot.queryByRole("dialog")).toBeNull();
  });

  it("opens a pull request only GitHub can rule on with m, and asks there", async () => {
    const slot = renderPanel("pulls", {
      getPull: () => ({
        pull: pullDetail({
          number: 3,
          title: "Review me",
          author: "hubot",
          reviewRequests: ["octocat"],
        }),
      }),
    });
    await slot.findByText("Review me");
    await act(async () => {});

    await act(async () => press("j"));
    await act(async () => press("m"));
    expect(slot.queryByRole("menu")).toBeNull();
    expect(slot.navigateCalls.at(-1)).toEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/get-bb/bb/3" },
    });

    const Panel = app.navPanels[0]!.component;
    slot.lifecycle.rerender(<Panel subPath="pulls/get-bb/bb/3" />);
    expect(
      await slot.findByRole("menuitem", { name: "Squash merge" }),
    ).toBeTruthy();
    expect(calls(slot, "mergePull")).toEqual([]);
  });

  it("offers Merge… in the row menu wherever m works, and asks in the detail", async () => {
    const slot = renderPanel("pulls", {
      getPull: () => ({
        pull: pullDetail({
          number: 3,
          title: "Review me",
          author: "hubot",
          reviewRequests: ["octocat"],
        }),
      }),
    });
    await slot.findByText("Review me");
    await act(async () => {});

    fireEvent.pointerDown(slot.getByRole("button", { name: "Actions for #3" }));
    await act(async () =>
      fireEvent.click(await slot.findByRole("menuitem", { name: /^Merge…/ })),
    );
    expect(slot.navigateCalls.at(-1)).toEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "pulls/get-bb/bb/3" },
    });

    const Panel = app.navPanels[0]!.component;
    slot.lifecycle.rerender(<Panel subPath="pulls/get-bb/bb/3" />);
    expect(
      await slot.findByRole("menuitem", { name: "Squash merge" }),
    ).toBeTruthy();
  });

  it("says why when the detail GitHub rules on can't merge after all", async () => {
    const toasts = toaster();
    const slot = renderPanel("pulls", {
      getPull: () => ({
        pull: pullDetail({
          number: 3,
          title: "Review me",
          author: "hubot",
          reviewRequests: ["octocat"],
          mergeStateStatus: "BLOCKED",
        }),
      }),
    });
    await slot.findByText("Review me");
    await act(async () => {});

    await act(async () => press("j"));
    await act(async () => press("m"));
    const Panel = app.navPanels[0]!.component;
    slot.lifecycle.rerender(<Panel subPath="pulls/get-bb/bb/3" />);
    await toasts.findByText("#3 can't be merged yet");
    expect(slot.queryByRole("menu")).toBeNull();
  });

  it("says it can't tell which pull requests are yours when GitHub won't name the viewer", async () => {
    const slot = renderPanel("pulls", {
      viewer: () => {
        throw new Error("gh api user failed");
      },
    });

    expect(
      await slot.findByText("Can't tell which pull requests are yours"),
    ).toBeTruthy();
    expect(slot.queryByText("Nothing needs you")).toBeNull();
  });

  it("says why m can't merge when the viewer can't write to the repository", async () => {
    const toasts = toaster();
    const slot = renderPanel("pulls", {
      repoSettings: () => ({
        repos: {
          "get-bb/bb": {
            viewerCanWrite: false,
            mergeMethods: ["squash"],
            defaultMergeMethod: "squash",
            deleteBranchOnMerge: false,
          },
        },
      }),
    });
    await slot.findByText("Review me");
    await act(async () => {});

    await act(async () => press("j"));
    await act(async () => press("m"));
    await toasts.findByText("#3 can't be merged yet");
    await toasts.findByText("You can't merge in get-bb/bb");
    expect(slot.queryByRole("menu")).toBeNull();
    expect(slot.navigateCalls).toEqual([]);
  });

  it("snoozes from the row menu, with a way back to the first step", async () => {
    const toasts = toaster();
    const slot = renderPanel();
    await slot.findByText("Fix my own shard");

    fireEvent.pointerDown(slot.getByRole("button", { name: "Actions for #6" }));
    fireEvent.click(await slot.findByRole("menuitem", { name: /^Snooze…/ }));
    expect(
      slot.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual([
      "Back",
      "Until checks change",
      "Until a new push",
      "Until tomorrow",
      "Until next week",
    ]);
    fireEvent.click(slot.getByRole("menuitem", { name: "Back" }));
    fireEvent.click(await slot.findByRole("menuitem", { name: /^Snooze…/ }));
    await act(async () =>
      fireEvent.click(
        slot.getByRole("menuitem", { name: "Until checks change" }),
      ),
    );
    expect(calls(slot, "snoozePull")).toEqual([
      { repo: "get-bb/bb", number: 6, rule: "checks", until: null },
    ]);
    await toasts.findByText("#6 snoozed until checks change");
    await act(async () =>
      fireEvent.click(toasts.getByRole("button", { name: "Undo" })),
    );
    expect(calls(slot, "unsnoozePull")).toEqual([
      { repo: "get-bb/bb", number: 6 },
    ]);
  });

  it("changes a row's status at once, keeps it shown until GitHub catches up, and undoes it", async () => {
    const toasts = toaster();
    const slot = renderPanel();
    await slot.findByText("Ship the inbox");

    fireEvent.pointerDown(slot.getByRole("button", { name: "Actions for #1" }));
    await act(async () =>
      fireEvent.click(
        await slot.findByRole("menuitem", { name: "Convert to draft" }),
      ),
    );
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 1, state: "draft" },
    ]);
    await toasts.findByText("#1 is a draft now");
    expect(
      slot.getByRole("button", {
        name: "#1 feat(list): Ship the inbox: Converted to draft",
      }),
    ).toBeTruthy();

    await act(async () =>
      fireEvent.click(toasts.getByRole("button", { name: "Undo" })),
    );
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 1, state: "draft" },
      { repo: "get-bb/bb", number: 1, state: "open" },
    ]);
    await toasts.findByText("#1 is ready for review");
  });

  it("filters with / and shows each qualifier as a removable chip", async () => {
    const slot = renderPanel("pulls/all");
    await slot.findByText("Ship the inbox");
    await act(async () => {});

    await act(async () => press("/"));
    const input = slot.getByRole("combobox");
    await waitFor(() => expect(document.activeElement).toBe(input));
    await act(async () =>
      fireEvent.change(input, { target: { value: "author:hubot " } }),
    );
    expect(slot.queryByText("Ship the inbox")).toBeNull();
    expect(slot.getByText("Review me")).toBeTruthy();
    expect(slot.getByText("Fix the flaky shard")).toBeTruthy();

    await act(async () =>
      fireEvent.click(
        slot.getByRole("button", { name: 'Remove "Author is hubot"' }),
      ),
    );
    expect(slot.getByText("Ship the inbox")).toBeTruthy();
  });

  it("leaves the filter with Esc without clearing it", async () => {
    const slot = renderPanel("pulls/all");
    await slot.findByText("Ship the inbox");
    await act(async () => {});

    await act(async () => press("/"));
    const input = slot.getByRole("combobox");
    await act(async () =>
      fireEvent.change(input, { target: { value: "author:hubot " } }),
    );
    await act(async () => fireEvent.keyDown(input, { key: "Escape" }));
    await act(async () => fireEvent.keyDown(input, { key: "Escape" }));
    expect(document.activeElement).not.toBe(input);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "#3 Review me: Your review is requested",
    );
    expect(
      slot.getByRole("button", { name: 'Remove "Author is hubot"' }),
    ).toBeTruthy();
    expect(slot.queryByText("Ship the inbox")).toBeNull();
  });

  it("restores a saved filter as chips without taking focus", async () => {
    window.localStorage.setItem(
      "bb-plugin-github:v4:query:pr",
      "author:hubot ",
    );
    const slot = renderPanel("pulls/all");

    await slot.findByText("Review me");
    await act(async () => {});
    expect(slot.queryByText("Ship the inbox")).toBeNull();
    expect(
      slot.getByRole("button", { name: 'Remove "Author is hubot"' }),
    ).toBeTruthy();
    expect(document.activeElement).not.toBe(slot.getByRole("combobox"));
    expect(slot.queryByRole("listbox")).toBeNull();
  });

  it("keeps the last sync on screen while GitHub is unreachable", async () => {
    const slot = renderPanel("pulls", {
      status: () => ({
        ...STATUS,
        ghOk: false,
        ghState: "unavailable",
        ghError: "connect ETIMEDOUT 140.82.112.6:443",
      }),
    });

    await slot.findByText("Ship the inbox");
    expect(
      await slot.findByText("Can't reach GitHub · showing the last sync"),
    ).toBeTruthy();
    expect(slot.queryByText(/ETIMEDOUT/)).toBeNull();
    await act(async () =>
      slot.getByRole("button", { name: "Try again" }).click(),
    );
    expect(calls(slot, "refresh")).toHaveLength(1);
  });

  it("leaves a pull request in its group while an agent works on it, and opens the thread with t", async () => {
    const slot = renderPanel(
      "pulls",
      {
        listLinks: () => ({
          links: { "pr:get-bb/bb#6": [link("pr", "thr-fix", 6)] },
        }),
      },
      {
        sidebarThreads: {
          threads: [sidebarThread({ id: "thr-fix", status: "active" })],
        },
      },
    );
    await slot.findByTitle("Fix · get-bb/bb#6");
    expect(regions(slot)).toEqual([
      "Your move",
      "Ready to merge",
      "Needs fixing",
    ]);
    expect(
      slot.getByRole("region", { name: "Needs fixing" }).textContent,
    ).toContain("Fix my own shard");

    await act(async () => press("j"));
    await act(async () => press("j"));
    await act(async () => press("j"));
    await act(async () => press("t"));
    expect(slot.navigateCalls).toContainEqual({
      method: "toThread",
      threadId: "thr-fix",
    });
  });
});

describe("GitHub pull request detail", () => {
  it("merges from the card's split button with the repo's default method, with no dialog", async () => {
    const toasts = toaster();
    const slot = renderPull(fakeGithub());

    const card = await nextStepCard(slot, "Ready to merge");
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Squash merge" })),
    );
    expect(slot.queryByRole("dialog")).toBeNull();
    expect(calls(slot, "mergePull")).toEqual([
      {
        repo: "get-bb/bb",
        number: 42,
        method: "squash",
        deleteBranch: false,
        headRefOid: "abc123",
      },
    ]);
    await toasts.findByText("Squash-merged #42 into main");
    await waitFor(() => expect(card.textContent).toContain("Merged into main"));
    expect(slot.queryByRole("button", { name: "Squash merge" })).toBeNull();
  });

  it("merges with another method from the split button's menu and deletes the branch only when asked", async () => {
    const slot = renderPull(fakeGithub());
    await nextStepCard(slot, "Ready to merge");

    fireEvent.pointerDown(
      slot.getByRole("button", { name: "Choose pull request merge method" }),
    );
    const remove = await slot.findByRole("menuitemcheckbox", {
      name: "Delete the branch",
    });
    expect(remove.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(remove);
    expect(
      slot
        .getByRole("menuitemcheckbox", { name: "Delete the branch" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    await act(async () =>
      fireEvent.click(slot.getByRole("menuitem", { name: "Merge" })),
    );
    expect(calls(slot, "mergePull")).toEqual([
      {
        repo: "get-bb/bb",
        number: 42,
        method: "merge",
        deleteBranch: true,
        headRefOid: "abc123",
      },
    ]);
    expect(
      window.localStorage.getItem("bb-plugin-github:v4:delete-branch"),
    ).toBe("1");
  });

  it("keeps the branch a bb worktree of the repository's project holds", async () => {
    window.localStorage.setItem("bb-plugin-github:v4:delete-branch", "1");
    const slot = renderPull(fakeGithub(), {
      sidebarThreads: { threads: [worktreeThread("project-1")] },
    });
    await nextStepCard(slot, "Ready to merge");
    fireEvent.pointerDown(
      slot.getByRole("button", { name: "Choose pull request merge method" }),
    );
    await slot.findByRole("menuitem", { name: "Merge" });
    expect(
      slot.queryByRole("menuitemcheckbox", { name: "Delete the branch" }),
    ).toBeNull();
    await act(async () =>
      fireEvent.click(slot.getByRole("menuitem", { name: "Squash merge" })),
    );
    expect(calls(slot, "mergePull")).toEqual([
      {
        repo: "get-bb/bb",
        number: 42,
        method: "squash",
        deleteBranch: false,
        headRefOid: "abc123",
      },
    ]);
  });

  it("ignores a worktree of another project that has the same branch name", async () => {
    window.localStorage.setItem("bb-plugin-github:v4:delete-branch", "1");
    const slot = renderPull(
      {
        ...fakeGithub(),
        status: () => ({
          ...STATUS,
          repos: [{ repo: "get-bb/bb", projectId: null }],
        }),
      },
      { sidebarThreads: { threads: [worktreeThread("project-2")] } },
    );
    await nextStepCard(slot, "Ready to merge");
    await waitFor(() => expect(calls(slot, "status").length).toBe(1));
    await act(async () => {});
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Squash merge" })),
    );
    expect(calls(slot, "mergePull")).toEqual([
      {
        repo: "get-bb/bb",
        number: 42,
        method: "squash",
        deleteBranch: true,
        headRefOid: "abc123",
      },
    ]);
  });

  it("leads with the viewer's review when it is requested, like the row, and names the failing checks", async () => {
    const slot = renderPull(
      fakeGithub({
        author: "hubot",
        reviewRequests: ["octocat"],
        checks: [check("lint", "failure", 9), check("build", "success")],
      }),
    );
    const card = await nextStepCard(slot, "Your review is requested");
    expect(card.textContent).toContain(
      "hubot asked you to review · 1 check failing",
    );
    expect(
      within(card)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["lintLog"]);
    expect(
      within(card)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Review on GitHub", "Squash merge", "", "Start an agent…"]);
  });

  it("lists the failing checks and starts an agent seeded from the pull request", async () => {
    const toasts = toaster();
    const spawn = vi.fn(async (request: { title?: string }) =>
      makeThreadResponse({ id: "thr-new", title: request.title ?? null }),
    );
    const slot = renderPull(
      {
        ...fakeGithub({
          checks: [
            check("lint", "failure", 9),
            check("unit (shard 2)", "failure", 9),
            check("build", "success"),
            check("docs", "skipped"),
          ],
        }),
        linkThread: () => ({ ok: true }),
      },
      { sdk: { threads: { spawn } } },
    );

    const card = await nextStepCard(slot, "2 checks failing");
    expect(card.textContent).toContain("1 passed · 1 skipped");
    expect(card.textContent).toContain("lint");
    expect(card.textContent).toContain("unit (shard 2)");

    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Start an agent…" })),
    );
    const dialog = await slot.findByRole("dialog");
    expect(dialog.textContent).toContain("#42 · checks out status-menu first");
    expect(slot.queryByRole("radio")).toBeNull();
    const prompt = (
      (await slot.findByTestId(
        "bb-new-thread-composer-input",
      )) as HTMLTextAreaElement
    ).value;
    expect(prompt).toContain(
      "Fix the failing checks on get-bb/bb#42 (status-menu → main).",
    );

    await act(async () =>
      fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit")),
    );
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn.mock.calls[0]?.[0]).toMatchObject({
      title: "Fix checks · get-bb/bb#42: Status menu",
    });
    expect(calls(slot, "linkThread")).toEqual([
      { kind: "pr", repo: "get-bb/bb", number: 42, threadId: "thr-new" },
    ]);
    await toasts.findByText("Agent started on #42");
    await waitFor(() => expect(slot.queryByRole("dialog")).toBeNull());
  });

  it("re-runs the failed checks from the card", async () => {
    const toasts = toaster();
    const slot = renderPull({
      ...fakeGithub({
        checks: [check("lint", "failure", 9), check("build", "success")],
      }),
      rerunFailedChecks: () => ({ ok: true, runs: 1, checks: 1 }),
    });

    await nextStepCard(slot, "1 check failing");
    await act(async () =>
      fireEvent.click(
        slot.getByRole("button", { name: "Re-run failed checks" }),
      ),
    );
    expect(calls(slot, "rerunFailedChecks")).toEqual([
      { repo: "get-bb/bb", number: 42 },
    ]);
    await toasts.findByText("Re-running 1 failed check on #42");
  });

  it("offers Reopen on a closed pull request", async () => {
    const slot = renderPull(
      fakeGithub({
        state: "CLOSED",
        viewerCanReopen: true,
        closedAt: "2026-08-21T00:00:00.000Z",
      }),
    );
    await nextStepCard(slot, "Closed without merging");
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Reopen" })),
    );
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "open" },
    ]);
  });

  it("tells the story on Activity and comments on GitHub", async () => {
    const github = fakeGithub({
      events: [
        {
          kind: "commit",
          actor: "octocat",
          createdAt: "2026-08-20T01:00:00.000Z",
          detail: "Add the menu",
        },
        {
          kind: "commit",
          actor: "octocat",
          createdAt: "2026-08-20T02:00:00.000Z",
          detail: "Polish the menu",
        },
      ],
      comments: [
        {
          author: "hubot",
          body: "Looks close.",
          createdAt: "2026-08-20T03:00:00.000Z",
        },
      ],
      reviews: [
        {
          author: "hubot",
          state: "APPROVED",
          body: "",
          createdAt: "2026-08-20T04:00:00.000Z",
        },
      ],
    });
    const slot = renderPull({
      ...github,
      commentPull: () => ({ ok: true }),
    });

    const activity = await slot.findByRole("tabpanel");
    await waitFor(() => expect(activity.textContent).toContain("Looks close."));
    expect(activity.textContent).toContain("pushed 2 commits");
    expect(activity.textContent).toContain("approved");

    const box = slot.getByRole("textbox", { name: "Comment" });
    await act(async () =>
      fireEvent.change(box, { target: { value: "Thanks, merging." } }),
    );
    await act(async () =>
      fireEvent.keyDown(box, { key: "Enter", metaKey: true }),
    );
    expect(calls(slot, "commentPull")).toEqual([
      { repo: "get-bb/bb", number: 42, body: "Thanks, merging." },
    ]);
    await waitFor(() => expect(calls(slot, "getPull")).toHaveLength(2));
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("colours the diff stat like core and opens the files from it", async () => {
    const scrollIntoView = stubScrollIntoView();
    const slot = renderPull(fakeGithub());

    const stat = await slot.findByRole("button", {
      name: "1,234 lines added and 56 removed in 3 files. Show the files",
    });
    expect(stat.querySelector(".text-diff-added")?.textContent).toBe("+1,234");
    expect(stat.querySelector(".text-diff-removed")?.textContent).toBe("-56");
    await act(async () => fireEvent.click(stat));
    expect(
      slot.getByRole("tab", { name: /^Files/ }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("copies the head branch name from its chip, like c and the row menu", async () => {
    const toasts = toaster();
    const slot = renderPull(fakeGithub());

    const chip = await slot.findByRole("button", {
      name: "Copy the branch name status-menu",
    });
    await act(async () => fireEvent.click(chip));
    expect(slot.experimental_clipboardWrites).toEqual([
      { text: "status-menu" },
    ]);
    await toasts.findByText("Copied the branch name");
  });

  it("shapes the loading card from the listed row, so loading doesn't move the tabs", async () => {
    let finish = () => {};
    const slot = renderPanel("pulls/get-bb/bb/2", {
      getPull: () =>
        new Promise<unknown>((resolve) => {
          finish = () =>
            resolve({
              pull: pullDetail({
                number: 2,
                title: "Fix the flaky shard",
                author: "hubot",
                mergeStateStatus: "UNSTABLE",
                checks: [
                  check("lint", "failure"),
                  check("unit", "failure"),
                  check("build", "success"),
                ],
              }),
            });
        }),
    });

    await waitFor(() =>
      expect(
        slot.getByRole("region", { name: "Next step" }).querySelectorAll("li"),
      ).toHaveLength(2),
    );
    const placeholders = slot.getByRole("region", { name: "Next step" })
      .lastElementChild?.childElementCount;

    await act(async () => finish());
    const card = await nextStepCard(slot, "2 checks failing");
    expect(card.querySelectorAll("li")).toHaveLength(2);
    expect(
      slot.getByRole("button", { name: "Re-run failed checks" }).parentElement
        ?.childElementCount,
    ).toBe(placeholders);
  });
});

describe("GitHub pull request status pill", () => {
  it("changes the status at once, shows it while GitHub catches up, and undoes it", async () => {
    const toasts = toaster();
    const slot = renderPull(fakeGithub());

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    );
    expect(
      slot.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Convert to draft", "Close pull request"]);
    await act(async () =>
      fireEvent.click(slot.getByRole("menuitem", { name: "Convert to draft" })),
    );
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "draft" },
    ]);
    expect(
      await slot.findByRole("button", {
        name: "Status: Draft. Change the status",
      }),
    ).toBeTruthy();

    await toasts.findByText("#42 is a draft now");
    await act(async () =>
      fireEvent.click(toasts.getByRole("button", { name: "Undo" })),
    );
    expect(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    ).toBeTruthy();
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "draft" },
      { repo: "get-bb/bb", number: 42, state: "open" },
    ]);
  });

  it("closes with one press and then offers Reopen", async () => {
    const slot = renderPull(fakeGithub());

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    );
    await act(async () =>
      fireEvent.click(
        slot.getByRole("menuitem", { name: "Close pull request" }),
      ),
    );
    expect(calls(slot, "setPullState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "closed" },
    ]);
    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Closed. Change the status",
      }),
    );
    expect(
      slot.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Reopen pull request"]);
  });

  it("offers Reopen right after Close, before GitHub reports the new state", async () => {
    const slot = renderPull({
      ...fakeGithub(),
      getPull: () => ({
        pull: pullDetail({ viewerCanClose: true, viewerCanReopen: false }),
      }),
    });

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    );
    await act(async () =>
      fireEvent.click(
        slot.getByRole("menuitem", { name: "Close pull request" }),
      ),
    );
    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Closed. Change the status",
      }),
    );
    expect(
      slot.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Reopen pull request"]);
  });

  it("shows the change in flight on the pill and keeps its menu shut", async () => {
    let finish = () => {};
    const github = fakeGithub();
    const slot = renderPull({
      ...github,
      setPullState: (input: unknown) =>
        new Promise<unknown>((resolve) => {
          finish = () => resolve(github.setPullState(input));
        }),
    });

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    );
    await act(async () =>
      fireEvent.click(slot.getByRole("menuitem", { name: "Convert to draft" })),
    );
    const pill = slot.getByRole("button", { name: "Converting to draft…" });
    expect(pill.getAttribute("aria-disabled")).toBe("true");
    fireEvent.pointerDown(pill);
    expect(slot.queryByRole("menu")).toBeNull();

    await act(async () => finish());
    expect(
      await slot.findByRole("button", {
        name: "Status: Draft. Change the status",
      }),
    ).toBeTruthy();
  });

  it("keeps the status when GitHub refuses the change, and says why", async () => {
    const toasts = toaster();
    const slot = renderPull(
      fakeGithub(
        { state: "DRAFT", isDraft: true },
        {
          failWith:
            "gh pr ready 42 failed: GraphQL: Resource not accessible by integration",
        },
      ),
    );

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Draft. Change the status",
      }),
    );
    await act(async () =>
      fireEvent.click(slot.getByRole("menuitem", { name: /^Mark ready/ })),
    );
    await toasts.findByText("Couldn't update #42");
    expect(
      toasts.getByText(
        "gh pr ready 42 failed: GraphQL: Resource not accessible by integration",
      ),
    ).toBeTruthy();
    expect(
      await slot.findByRole("button", {
        name: "Status: Draft. Change the status",
      }),
    ).toBeTruthy();
  });

  it("shows a plain status when the pull request cannot change", async () => {
    for (const [initial, label] of [
      [{ state: "MERGED", mergedAt: "2026-08-21T00:00:00.000Z" }, "Merged"],
      [
        {
          viewerCanUpdate: false,
          viewerCanClose: false,
          viewerCanReopen: false,
          viewerCanMerge: false,
        },
        "Open",
      ],
    ] as const) {
      const slot = renderPull(fakeGithub(initial));
      expect(
        await slot.findByRole("status", { name: `Status: ${label}` }),
      ).toBeTruthy();
      expect(slot.queryByRole("button", { name: /^Status:/ })).toBeNull();
      slot.lifecycle.unmount();
    }
  });
});

describe("GitHub thread panel", () => {
  it("shows the linked pull request and keeps removed files out of workspace navigation", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-1", environment: null, params: null },
      {
        rpc: rpc({
          pullForThread: () => ({
            pull: { repo: "get-bb/bb", number: 42, environmentId: "env-1" },
          }),
          getPull: () => ({
            pull: pullDetail({
              title: "Navigation fix",
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
        }),
      },
    );

    const filesTab = await slot.findByRole("tab", { name: /^Files/ });
    await act(async () => fireEvent.mouseDown(filesTab));
    expect(slot.getByText("removed.ts").closest("a")).toBeNull();
    expect(
      slot.getByText("modified.ts").closest("a")?.getAttribute("href"),
    ).toBe("./modified.ts");
    expect(slot.getByTestId("bb-diff").getAttribute("data-path")).toBe(
      "removed.ts",
    );
    const toggle = slot.getByRole("button", { name: "Collapse removed.ts" });
    await act(async () => fireEvent.click(toggle));
    expect(slot.queryByTestId("bb-diff")).toBeNull();
    expect(toggle.getAttribute("aria-label")).toBe("Expand removed.ts");
  });

  it("lets the user pick a pull request when the thread has none", async () => {
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr-1", environment: null, params: null },
      {
        rpc: rpc({
          pullForThread: () => ({ pull: null }),
          getPull: () => ({
            pull: pullDetail({ number: 3, title: "Review me" }),
          }),
        }),
      },
    );

    const pick = await slot.findByRole("button", { name: /Review me/ });
    expect(slot.queryByText("Still a draft")).toBeTruthy();
    await act(async () => fireEvent.click(pick));
    expect(calls(slot, "getPull")).toEqual([{ repo: "get-bb/bb", number: 3 }]);
  });
});

describe("GitHub issues", () => {
  const issueDetail = (overrides: Record<string, unknown> = {}) => ({
    issue: {
      repo: "get-bb/bb",
      number: 42,
      title: "Route-backed issue",
      state: "OPEN",
      author: "hubot",
      body: "Steps to reproduce.",
      labels: [],
      assignees: [],
      url: "https://github.com/get-bb/bb/issues/42",
      updatedAt: "2026-08-20T00:00:00.000Z",
      comments: [],
      ...overrides,
    },
  });

  it("lists open issues, keeps closed ones folded, and opens one", async () => {
    const slot = renderPanel("issues");

    const row = await slot.findByRole("button", {
      name: "#42 Route-backed issue",
    });
    expect(slot.queryByText("Old issue")).toBeNull();
    expect(slot.getByRole("button", { name: /^Closed/ })).toBeTruthy();
    await act(async () => fireEvent.click(row));
    expect(slot.navigateCalls.at(-1)).toEqual({
      method: "toPluginPanel",
      path: "github",
      options: { subPath: "issues/get-bb/bb/42" },
    });
  });

  it("suggests the issues' own authors in the Issues filter", async () => {
    const slot = renderPanel("issues");
    await slot.findByText("Route-backed issue");
    await act(async () => {});

    await act(async () => press("/"));
    const input = slot.getByRole("combobox");
    await act(async () =>
      fireEvent.change(input, { target: { value: "author:mona" } }),
    );
    expect(slot.getByRole("option", { name: /monalisa/ })).toBeTruthy();
  });

  it("assigns the viewer from an issue's menu and undoes it", async () => {
    const toasts = toaster();
    const slot = renderPanel("issues", {
      setAssignees: (input) => ({
        ok: true,
        assignees: field(input, "assignees"),
      }),
    });

    fireEvent.pointerDown(
      await slot.findByRole("button", { name: "Actions for #42" }),
    );
    const assign = await slot.findByRole("menuitem", { name: "Assign to me" });
    await act(async () => fireEvent.click(assign));
    expect(calls(slot, "setAssignees")).toEqual([
      { repo: "get-bb/bb", number: 42, assignees: ["octocat"] },
    ]);
    await toasts.findByText("Assigned you to #42");
    await act(async () =>
      fireEvent.click(toasts.getByRole("button", { name: "Undo" })),
    );
    expect(calls(slot, "setAssignees")).toEqual([
      { repo: "get-bb/bb", number: 42, assignees: ["octocat"] },
      { repo: "get-bb/bb", number: 42, assignees: [] },
    ]);
  });

  it("closes an issue from its status pill and undoes it", async () => {
    const toasts = toaster();
    const slot = renderPanel("issues/get-bb/bb/42", {
      getIssue: () => issueDetail(),
      setIssueState: () => ({ ok: true }),
    });

    fireEvent.pointerDown(
      await slot.findByRole("button", {
        name: "Status: Open. Change the status",
      }),
    );
    await act(async () =>
      fireEvent.click(slot.getByRole("menuitem", { name: "Close issue" })),
    );
    expect(calls(slot, "setIssueState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "closed" },
    ]);
    expect(
      await slot.findByRole("button", {
        name: "Status: Closed. Change the status",
      }),
    ).toBeTruthy();
    await toasts.findByText("Closed #42");
    await act(async () =>
      fireEvent.click(toasts.getByRole("button", { name: "Undo" })),
    );
    expect(calls(slot, "setIssueState")).toEqual([
      { repo: "get-bb/bb", number: 42, state: "closed" },
      { repo: "get-bb/bb", number: 42, state: "open" },
    ]);
  });

  it("starts an agent on an issue and links its thread", async () => {
    const toasts = toaster();
    const spawn = vi.fn(async (request: { title?: string }) =>
      makeThreadResponse({ id: "thr-issue", title: request.title ?? null }),
    );
    const slot = renderPanel(
      "issues/get-bb/bb/42",
      { getIssue: () => issueDetail(), linkThread: () => ({ ok: true }) },
      { sdk: { threads: { spawn } } },
    );

    const start = await slot.findByRole("button", { name: "Start an agent…" });
    await act(async () => fireEvent.click(start));
    const prompt = (
      (await slot.findByTestId(
        "bb-new-thread-composer-input",
      )) as HTMLTextAreaElement
    ).value;
    expect(prompt).toContain(
      "Work on GitHub issue get-bb/bb#42: Route-backed issue",
    );
    await act(async () =>
      fireEvent.click(slot.getByTestId("bb-new-thread-composer-submit")),
    );
    expect(spawn.mock.calls[0]?.[0]).toMatchObject({
      title: "get-bb/bb#42: Route-backed issue",
    });
    expect(calls(slot, "linkThread")).toEqual([
      { kind: "issue", repo: "get-bb/bb", number: 42, threadId: "thr-issue" },
    ]);
    await toasts.findByText("Agent started on #42");
  });

  it("creates an issue and replaces the form with it in history", async () => {
    const slot = renderPanel("new", {
      createIssue: () => ({
        number: 77,
        url: "https://github.com/get-bb/bb/issues/77",
      }),
    });

    const title = await slot.findByRole("textbox", { name: "Title" });
    await act(async () =>
      fireEvent.change(title, { target: { value: "Crash on start" } }),
    );
    await act(async () => fireEvent.keyDown(title, { key: "Enter" }));
    expect(calls(slot, "createIssue")).toEqual([]);
    expect(document.activeElement).toBe(
      slot.getByRole("textbox", { name: "Description" }),
    );
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Create issue" })),
    );
    expect(calls(slot, "createIssue")).toEqual([
      { repo: "get-bb/bb", title: "Crash on start", body: "" },
    ]);
    await waitFor(() =>
      expect(slot.navigateCalls.at(-1)).toEqual({
        method: "toPluginPanel",
        path: "github",
        options: { subPath: "issues/get-bb/bb/77", replace: true },
      }),
    );
  });
});

describe("GitHub home page, badge, and commands", () => {
  it("lists what needs the viewer on the home page, with no summary line", async () => {
    const slot = renderSlot(
      app.homepageSections[0]!,
      { projectId: "project-1" },
      { rpc: rpc() },
    );

    await slot.findByText("Review me");
    expect(slot.getByText("Ship the inbox")).toBeTruthy();
    expect(slot.getByText("Fix my own shard")).toBeTruthy();
    expect(slot.queryByText("Fix the flaky shard")).toBeNull();
    expect(slot.queryByText(/your move ·/i)).toBeNull();
    await act(async () =>
      fireEvent.click(slot.getByRole("button", { name: "Open the inbox" })),
    );
    expect(slot.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "github",
    });
  });

  it("badges the panel with the same count as the Inbox tab", async () => {
    const useBadge = app.navPanels[0]!.experimental_useBadge!;
    function Probe() {
      const badge = useBadge();
      return (
        <output>
          {badge === null ? "none" : `${badge.count}|${badge.label}`}
        </output>
      );
    }
    const slot = renderSlot({ component: Probe }, {}, { rpc: rpc() });
    expect((await slot.findByText(/^3\|/)).textContent).toBe(
      "3|3 pull requests need you",
    );
  });

  it("adds no thread header chip, overlay, or row statuses, and one command for the thread's pull request", async () => {
    expect(app.threadHeaderActions).toEqual([]);
    expect(app.appOverlays).toEqual([]);
    expect(app.contentScripts).toEqual([]);
    expect(THREAD_PULL_COMMAND.title).toBe(
      "GitHub: Open this thread's pull request",
    );
    const panel = experimental_makePanelController({
      openTab: vi.fn(() => true),
    });
    const context = (threadId: string | null): PluginCommandContext => ({
      threadId,
      projectId: "project-1",
      experimental_panel: panel,
    });
    expect(THREAD_PULL_COMMAND.isAvailable?.(context(null))).toBe(false);
    expect(THREAD_PULL_COMMAND.isAvailable?.(context("thr-1"))).toBe(true);
    await THREAD_PULL_COMMAND.run(context("thr-1"));
    expect(panel.openTab).toHaveBeenCalledWith({
      tab: { id: "pull", context: { kind: "thread" }, availability: "action" },
    });
  });
});
