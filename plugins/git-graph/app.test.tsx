// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  mountPluginContentScripts,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type {
  CommitDetailOutput,
  HistoryOutput,
  OverviewOutput,
  ProjectsOutput,
  RepoStatusOutput,
} from "./contract.js";
import {
  projectFromPathname,
  readLastProjectRoute,
  writeLastProjectRoute,
} from "./project-origin.js";
import { computeGraphLayout } from "./graph/layout.js";
import {
  GRAPH_MIN_WIDTH,
  graphColumnWidth,
  ROW_HEIGHT,
} from "./graph/geometry.js";

const app = await loadPluginApp(() => import("./app"));

function commit(
  hash: string,
  subject: string,
  parents: string[],
  refs: HistoryOutput["commits"][number]["refs"] = [],
): HistoryOutput["commits"][number] {
  return {
    hash,
    abbrev: hash.slice(0, 7),
    parents,
    subject,
    authorName: "Alice",
    authorEmail: "alice@example.com",
    authorDate: "2026-09-01T10:00:00Z",
    refs,
  };
}

const projects: ProjectsOutput = {
  projects: [
    {
      id: "proj_1",
      name: "Widgets",
      sources: [
        {
          id: "src_1",
          path: "C:/checkouts/widgets",
          hostId: "host_1",
          hostName: "Office PC",
          isDefault: true,
        },
      ],
    },
  ],
};

const overview: OverviewOutput = {
  source: {
    id: "src_1",
    path: "C:/checkouts/widgets",
    hostId: "host_1",
    hostName: "Office PC",
    isDefault: true,
  },
  scanTruncated: false,
  scanError: null,
  repos: [
    {
      relPath: "",
      position: "root",
      gitLink: "direct",
      head: { abbrev: "aaaa123", branch: "main", detached: false },
      empty: false,
      error: null,
    },
    {
      relPath: "tools/cli",
      position: "nested",
      gitLink: "direct",
      head: { abbrev: "bbbb456", branch: null, detached: true },
      empty: false,
      error: null,
    },
  ],
};

const history: HistoryOutput = {
  commits: [
    commit(
      "aaaaaaaa",
      "Merge feature",
      ["bbbbbbbb", "cccccccc"],
      [
        { name: "main", kind: "branch", isHead: true },
        { name: "origin/main", kind: "remote", isHead: false },
      ],
    ),
    commit("bbbbbbbb", "Add feature", ["dddddddd"]),
    commit(
      "dddddddd",
      "Initial commit",
      [],
      [{ name: "v1.0", kind: "tag", isHead: false }],
    ),
  ],
  empty: false,
};

const crowdedHistory: HistoryOutput = {
  commits: [
    commit(
      "aaaaaaaa",
      "Release",
      [],
      [
        { name: "main", kind: "branch", isHead: true },
        { name: "origin/main", kind: "remote", isHead: false },
        { name: "release", kind: "branch", isHead: false },
        { name: "origin/hotfix", kind: "remote", isHead: false },
        { name: "v2.0.0", kind: "tag", isHead: false },
        {
          name: "local/rel-4.1.1.22-hf1/einvoice-1.0.10",
          kind: "tag",
          isHead: false,
        },
      ],
    ),
  ],
  empty: false,
};

const status: RepoStatusOutput = {
  dirty: {
    staged: 1,
    unstaged: 1,
    untracked: 1,
    conflicted: 0,
    total: 3,
    truncated: false,
  },
  branches: [
    {
      fullName: "refs/heads/main",
      shortName: "main",
      isRemote: false,
      isHead: true,
    },
    {
      fullName: "refs/heads/feature",
      shortName: "feature",
      isRemote: false,
      isHead: false,
    },
    {
      fullName: "refs/remotes/origin/main",
      shortName: "origin/main",
      isRemote: true,
      isHead: false,
    },
  ],
  branchCount: 2,
  tagCount: 1,
  remoteRefCount: 1,
  error: null,
};

const cleanStatus: RepoStatusOutput = {
  ...status,
  dirty: {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    total: 0,
    truncated: false,
  },
};

const detail: CommitDetailOutput = {
  commit: {
    hash: "aaaaaaaa",
    abbrev: "aaaa123",
    tree: "tree1",
    parents: [
      { hash: "bbbbbbbb", abbrev: "bbbb456", subject: "Add feature" },
      { hash: "cccccccc", abbrev: "cccc789", subject: "Other branch" },
    ],
    author: {
      name: "Alice",
      email: "alice@example.com",
      date: "2026-09-01T10:00:00Z",
    },
    committer: {
      name: "Alice",
      email: "alice@example.com",
      date: "2026-09-01T10:00:00Z",
    },
    message: "Merge feature\n\nLonger body",
    refs: [{ name: "main", kind: "branch", isHead: true }],
    isMerge: true,
    isRoot: false,
  },
  files: [
    { path: "src/new.ts", status: "added", oldPath: null },
    { path: "src/old.ts", status: "modified", oldPath: null },
  ],
  filesNote: null,
};

type RpcStubMap = Record<string, (input: unknown) => unknown>;

function defaultRpc(): RpcStubMap {
  return {
    projects: () => projects,
    overview: () => overview,
    repoStatus: () => status,
    history: () => history,
    commitDetail: () => detail,
    filePatch: () => ({
      patch: "--- a/src/new.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n-old\n+new\n",
      truncated: false,
    }),
  };
}

function renderPanel(rpc: RpcStubMap = defaultRpc()) {
  return renderSlot(
    app.navPanels[0]!,
    { subPath: "" },
    {
      rpc,
      context: { projectId: "proj_1", threadId: null },
    },
  );
}

function lanesIn(container: HTMLElement): SVGSVGElement | null {
  return container.querySelector<SVGSVGElement>(
    "[data-testid='git-graph-lanes']",
  );
}

async function withMeasuredWidth(width: number, run: () => Promise<void>) {
  class FakeResizeObserver {
    private readonly callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }
    observe() {
      this.callback([], this);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  Object.defineProperty(HTMLElement.prototype, "clientWidth", {
    configurable: true,
    get: () => width,
  });
  try {
    await run();
  } finally {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(HTMLElement.prototype, "clientWidth");
  }
}

beforeEach(() => {
  vi.useRealTimers();
  window.localStorage.clear();
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => {};
  HTMLElement.prototype.releasePointerCapture = () => {};
  HTMLElement.prototype.scrollIntoView = () => {};
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("Git Graph panel", () => {
  it("registers a nav panel with the GitBranch icon", () => {
    expect(app.navPanels).toHaveLength(1);
    expect(app.navPanels[0]).toMatchObject({
      id: "git-graph",
      title: "Git Graph",
      icon: "GitBranch",
      path: "git-graph",
    });
  });

  it("renders commits with ref chips, routed lanes, the dirty badge, and the host", async () => {
    const slot = renderPanel();
    expect(await slot.findByText("Merge feature")).toBeTruthy();
    expect(await slot.findByText("v1.0")).toBeTruthy();
    const headChip = slot.container.querySelector("[data-ref-kind='head']");
    expect(headChip?.getAttribute("title")).toBe(
      "HEAD → main (checked out)\nAlso on origin/main",
    );
    expect(
      headChip?.querySelector("[data-testid='git-graph-ref-remotes']")
        ?.textContent,
    ).toBe("origin");
    expect(slot.container.querySelector("[data-ref-kind='remote']")).toBeNull();
    expect(
      slot.container
        .querySelector("[data-ref-kind='tag']")
        ?.getAttribute("title"),
    ).toBe("Tag v1.0");

    const lanes = lanesIn(slot.container);
    expect(lanes?.querySelectorAll("line")).toHaveLength(0);
    expect(lanes?.querySelectorAll("g[data-to]:not([data-open])")).toHaveLength(
      3,
    );
    expect(lanes?.querySelectorAll("g[data-open='true']")).toHaveLength(1);
    expect(
      lanes
        ?.querySelector("[data-node-kind='head']")
        ?.getAttribute("data-hash"),
    ).toBe("aaaaaaaa");
    expect(lanes?.querySelector("[data-node-kind='uncommitted']")).toBeTruthy();
    expect(lanes?.querySelectorAll("mask circle")).toHaveLength(2);
    expect(
      lanes
        ?.querySelector("g[data-to='aaaaaaaa'] path")
        ?.getAttribute("stroke-dasharray"),
    ).toBe("2 3");

    expect(slot.getAllByText("3 changed")).toHaveLength(2);
    expect(slot.getByText("Initial commit")).toBeTruthy();
    expect(slot.getByText("C:/checkouts/widgets @ Office PC")).toBeTruthy();
    slot.unmount();
  });

  it("shows the repository picker with both repositories", async () => {
    const slot = renderPanel();
    await slot.findByText("Merge feature");
    const triggers = slot.container.querySelectorAll("button[role='combobox']");
    expect(triggers.length).toBe(1);
    expect(triggers[0]?.textContent).toContain("(project root)");
    expect(triggers[0]?.textContent).toContain("main");
    expect(
      slot.getByRole("button", { name: "Branches", hidden: true }).textContent,
    ).toContain("Show All");
    slot.unmount();
  });

  it("filters history by several selected branches", async () => {
    const historyMock = vi.fn((_input: unknown) => history);
    const slot = renderPanel({ ...defaultRpc(), history: historyMock });
    await slot.findByText("Merge feature");
    const toggleBranch = async (name: RegExp) => {
      if (slot.queryAllByRole("menuitemcheckbox").length === 0) {
        fireEvent.keyDown(
          slot.getByRole("button", { name: "Branches", hidden: true }),
          {
            key: "Enter",
          },
        );
      }
      fireEvent.click(await slot.findByRole("menuitemcheckbox", { name }));
    };
    expect(slot.queryByRole("menuitemcheckbox", { name: /origin/ })).toBeNull();
    await toggleBranch(/^main/);
    await toggleBranch(/^feature/);
    await waitFor(() => {
      expect(historyMock).toHaveBeenLastCalledWith(
        expect.objectContaining({
          refs: ["refs/heads/main", "refs/heads/feature"],
        }),
      );
    });
    expect(
      slot.getByRole("button", { name: "Branches", hidden: true }).textContent,
    ).toContain("2 branches");
    await toggleBranch(/^Show All/);
    await waitFor(() => {
      expect(historyMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ refs: [] }),
      );
    });
    slot.unmount();
  });

  it("keeps the selected commit's ancestry highlighted while hovering other rows", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      repoStatus: () => cleanStatus,
    });
    await slot.findByText("Merge feature");
    const mergeRow = slot.getByText("Merge feature").closest("button");
    const featureRow = slot.getByText("Add feature").closest("button");
    fireEvent.click(featureRow!);
    await waitFor(() => {
      expect(mergeRow?.classList.contains("opacity-40")).toBe(true);
    });
    const dimmedEdges = () =>
      [
        ...(lanesIn(slot.container)?.querySelectorAll(
          "g[data-from][data-dim='true']",
        ) ?? []),
      ].map(
        (edge) =>
          `${edge.getAttribute("data-from")}>${edge.getAttribute("data-to")}`,
      );
    const selectedHighlight = dimmedEdges();
    expect(selectedHighlight.length).toBeGreaterThan(0);
    fireEvent.mouseEnter(mergeRow!);
    expect(mergeRow?.classList.contains("opacity-40")).toBe(true);
    expect(dimmedEdges()).toEqual(selectedHighlight);
    fireEvent.mouseLeave(mergeRow!);
    fireEvent.click(featureRow!);
    fireEvent.mouseEnter(featureRow!);
    await waitFor(() => {
      expect(mergeRow?.classList.contains("opacity-40")).toBe(true);
    });
    fireEvent.mouseEnter(mergeRow!);
    await waitFor(() => {
      expect(mergeRow?.classList.contains("opacity-40")).toBe(false);
    });
    slot.unmount();
  });

  it("switches project and source together", async () => {
    const secondOverview: OverviewOutput = {
      ...overview,
      source: {
        id: "src_2",
        path: "C:/checkouts/second",
        hostId: "host_1",
        hostName: "Office PC",
        isDefault: true,
      },
    };
    const overviewMock = vi.fn((input: unknown) => {
      const request = input as { projectId: string; sourceId?: string };
      if (request.projectId === "proj_2" && request.sourceId !== "src_2") {
        throw new Error("source does not belong to project");
      }
      return request.projectId === "proj_2" ? secondOverview : overview;
    });
    const slot = renderPanel({
      ...defaultRpc(),
      projects: () => ({
        projects: [
          ...projects.projects,
          {
            id: "proj_2",
            name: "Second",
            sources: [
              {
                id: "src_2",
                path: "C:/checkouts/second",
                hostId: "host_1",
                hostName: "Office PC",
                isDefault: true,
              },
            ],
          },
        ],
      }),
      overview: overviewMock,
    });
    await slot.findByText("Merge feature");
    const projectSelect = slot.getByRole("combobox", { name: "Project" });
    projectSelect.focus();
    fireEvent.keyDown(projectSelect, { key: "ArrowDown" });
    const secondOption = await slot.findByRole("option", { name: "Second" });
    fireEvent.click(secondOption);
    await waitFor(() => {
      expect(overviewMock).toHaveBeenCalledWith({
        projectId: "proj_2",
        sourceId: "src_2",
        refresh: false,
      });
    });
    expect(slot.queryByText("source does not belong to project")).toBeNull();
    slot.unmount();
  });

  it("sends the debounced search query with the selected source to history", async () => {
    const historyMock = vi.fn(() => history);
    const slot = renderPanel({ ...defaultRpc(), history: historyMock });
    await slot.findByText("Merge feature");
    fireEvent.change(slot.getByLabelText("Search commit messages"), {
      target: { value: "feature" },
    });
    await waitFor(
      () => {
        expect(historyMock).toHaveBeenCalledWith(
          expect.objectContaining({ query: "feature", sourceId: "src_1" }),
        );
      },
      { timeout: 3_000 },
    );
    slot.unmount();
  });

  it("opens a commit card with metadata, parents, and changed files", async () => {
    const detailMock = vi.fn(() => detail);
    const slot = renderPanel({ ...defaultRpc(), commitDetail: detailMock });
    await slot.findByText("Merge feature");
    fireEvent.click(slot.getByText("Merge feature"));
    await waitFor(() => {
      expect(detailMock).toHaveBeenCalledWith(
        expect.objectContaining({ hash: "aaaaaaaa", sourceId: "src_1" }),
      );
    });
    expect(await slot.findByText("Merge")).toBeTruthy();
    expect(await slot.findByText(/alice@example.com/u)).toBeTruthy();
    expect(await slot.findByText("src/new.ts")).toBeTruthy();
    const card = slot.getByRole("complementary", { name: "Commit details" });
    expect(card.querySelector("button[title='Add feature']")).toBeTruthy();
    slot.unmount();
  });

  it("loads a patch when a changed file is clicked", async () => {
    const patchMock = vi.fn(() => ({
      patch: "--- a/src/new.ts\n+++ b/src/new.ts\n@@ -1 +1 @@\n-old\n+new\n",
      truncated: false,
    }));
    const slot = renderPanel({ ...defaultRpc(), filePatch: patchMock });
    await slot.findByText("Merge feature");
    fireEvent.click(slot.getByText("Merge feature"));
    const fileRow = await slot.findByText("src/new.ts");
    fireEvent.click(fileRow);
    await waitFor(() => {
      expect(patchMock).toHaveBeenCalledWith(
        expect.objectContaining({
          hash: "aaaaaaaa",
          path: "src/new.ts",
        }),
      );
    });
    slot.unmount();
  });

  it("renders the column header row and the uncommitted changes row", async () => {
    const slot = renderPanel();
    await slot.findByText("Merge feature");
    expect(slot.getByText("Graph")).toBeTruthy();
    expect(slot.getByText("Description")).toBeTruthy();
    expect(slot.getByText("Author")).toBeTruthy();
    expect(slot.getByText("Date")).toBeTruthy();
    const uncommitted = slot.container.querySelector(
      "[data-testid='git-graph-uncommitted']",
    );
    expect(uncommitted).toBeTruthy();
    expect(slot.getByText("Uncommitted changes")).toBeTruthy();
    slot.unmount();
  });

  it("omits the uncommitted row when the working copy is clean", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      repoStatus: () => cleanStatus,
    });
    await slot.findByText("Merge feature");
    expect(
      slot.container.querySelector("[data-testid='git-graph-uncommitted']"),
    ).toBeNull();
    expect(
      lanesIn(slot.container)?.querySelector("[data-node-kind='uncommitted']"),
    ).toBeNull();
    slot.unmount();
  });

  it("keeps the uncommitted row on the HEAD lane when newer branch tips are listed first", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      history: () => ({
        commits: [
          commit(
            "eeeeeeee",
            "Newer work on another branch",
            ["dddddddd"],
            [{ name: "topic", kind: "branch", isHead: false }],
          ),
          commit(
            "aaaaaaaa",
            "Checked out work",
            ["dddddddd"],
            [{ name: "main", kind: "branch", isHead: true }],
          ),
          commit("dddddddd", "Shared base", []),
        ],
        empty: false,
      }),
    });
    await slot.findByText("Checked out work");
    expect(
      slot.container.querySelector("[data-testid='git-graph-uncommitted']"),
    ).toBeTruthy();
    const lanes = lanesIn(slot.container);
    const headDot = lanes?.querySelector("[data-node-kind='head'] circle");
    const uncommittedDot = lanes?.querySelector(
      "[data-node-kind='uncommitted'] circle",
    );
    expect(headDot?.getAttribute("cx")).toBe(
      uncommittedDot?.getAttribute("cx"),
    );
    expect(
      lanes
        ?.querySelector("g[data-to='aaaaaaaa'] path")
        ?.getAttribute("stroke-dasharray"),
    ).toBe("2 3");
    slot.unmount();
  });

  it("sizes the graph column once for the whole history and keeps it while scrolling", async () => {
    const linear = Array.from({ length: 40 }, (_, index) =>
      commit(`top${index}`, `Linear ${index}`, [
        index === 39 ? "base" : `top${index + 1}`,
      ]),
    );
    const tips = Array.from({ length: 6 }, (_, index) =>
      commit(`tip${index}`, `Tip ${index}`, [`side${index}`]),
    );
    const sides = Array.from({ length: 6 }, (_, index) =>
      commit(`side${index}`, `Side ${index}`, ["base"]),
    );
    const wide = [...linear, ...tips, ...sides, commit("base", "Base", [])];
    const maxLane = computeGraphLayout(wide).maxLane;
    expect(maxLane).toBe(6);
    const expected = `${graphColumnWidth(maxLane)}px`;
    const slot = renderPanel({
      ...defaultRpc(),
      repoStatus: () => cleanStatus,
      history: () => ({ commits: wide, empty: false }),
    });
    await slot.findByText("Linear 0");
    const columnWidths = () => [
      slot.container.querySelector<HTMLElement>(
        "[data-testid='git-graph-header-graph']",
      )?.style.width,
      `${lanesIn(slot.container)?.getAttribute("width")}px`,
      ...[
        ...slot.container.querySelectorAll<HTMLElement>(
          "[data-testid='git-graph-row-graph']",
        ),
      ].map((cell) => cell.style.width),
    ];
    expect(new Set(columnWidths())).toEqual(new Set([expected]));
    expect(
      lanesIn(slot.container)?.querySelectorAll("[data-node-kind]").length,
    ).toBeLessThan(wide.length);

    const scroller = slot.container.querySelector<HTMLElement>(
      "[data-testid='git-graph-scroller']",
    );
    expect(scroller).toBeTruthy();
    scroller!.scrollTop = 40 * ROW_HEIGHT;
    fireEvent.scroll(scroller!);
    expect(await slot.findByText("Tip 3")).toBeTruthy();
    expect(slot.queryByText("Linear 0")).toBeNull();
    expect(new Set(columnWidths())).toEqual(new Set([expected]));
    slot.unmount();
  });

  it("caps ref chips per row and lists the rest in the overflow tooltip", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      history: () => crowdedHistory,
    });
    const row = (await slot.findByText("Release")).closest("button");
    expect(
      row?.querySelectorAll("[data-ref-kind]:not([data-ref-kind='overflow'])"),
    ).toHaveLength(2);
    expect(
      row?.querySelector("[data-testid='git-graph-ref-remotes']")?.textContent,
    ).toBe("origin");
    const overflow = row?.querySelector("[data-ref-kind='overflow']");
    expect(overflow?.textContent).toBe("+3");
    expect(overflow?.getAttribute("title")).toContain(
      "Tag local/rel-4.1.1.22-hf1/einvoice-1.0.10",
    );
    slot.unmount();
  });

  it("fits one readable ref chip into a narrow description column", async () => {
    await withMeasuredWidth(180, async () => {
      const slot = renderPanel({
        ...defaultRpc(),
        history: () => crowdedHistory,
      });
      const row = (await slot.findByText("Release")).closest("button");
      await waitFor(() => {
        expect(
          row?.querySelector("[data-ref-kind='overflow']")?.textContent,
        ).toBe("+4");
      });
      const visible = row?.querySelectorAll(
        "[data-ref-kind]:not([data-ref-kind='overflow'])",
      );
      expect(visible).toHaveLength(1);
      expect(visible?.[0]?.getAttribute("data-ref-kind")).toBe("head");
      expect(
        row?.querySelector("[data-testid='git-graph-ref-remotes']"),
      ).toBeNull();
      slot.unmount();
    });
  });

  it("lays search results out without lanes to unloaded parents and hides the uncommitted row", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      history: () => ({
        commits: [
          commit(
            "aaaaaaaa",
            "fix: first",
            ["11111111"],
            [{ name: "main", kind: "branch", isHead: true }],
          ),
          commit("bbbbbbbb", "fix: second", ["22222222"]),
          commit("cccccccc", "fix: third", ["33333333"]),
        ],
        empty: false,
      }),
    });
    await slot.findByText("fix: first");
    const headerGraphWidth = () =>
      slot.container.querySelector<HTMLElement>(
        "[data-testid='git-graph-header-graph']",
      )?.style.width;
    expect(headerGraphWidth()).toBe(`${graphColumnWidth(2)}px`);
    fireEvent.change(slot.getByLabelText("Search commit messages"), {
      target: { value: "fix" },
    });
    await waitFor(
      () => {
        expect(headerGraphWidth()).toBe(`${GRAPH_MIN_WIDTH}px`);
      },
      { timeout: 3_000 },
    );
    expect(
      slot.container.querySelector("[data-testid='git-graph-uncommitted']"),
    ).toBeNull();
    expect(
      lanesIn(slot.container)?.querySelectorAll("g[data-open='true']"),
    ).toHaveLength(0);
    slot.unmount();
  });

  it("dims edges and rows outside the ancestry chain on hover", async () => {
    const slot = renderPanel();
    await slot.findByText("Merge feature");
    const row = slot.getByText("Add feature").closest("button");
    expect(row).toBeTruthy();
    fireEvent.mouseEnter(row!);
    await waitFor(() => {
      expect(
        lanesIn(slot.container)?.querySelectorAll(
          "g[data-from][data-dim='true']",
        ).length,
      ).toBeGreaterThanOrEqual(2);
    });
    expect(
      slot
        .getByText("Merge feature")
        .closest("button")
        ?.classList.contains("opacity-40"),
    ).toBe(true);
    expect(
      slot
        .getByText("Uncommitted changes")
        .closest("button")
        ?.classList.contains("opacity-40"),
    ).toBe(true);
    fireEvent.mouseLeave(row!);
    await waitFor(() => {
      expect(
        lanesIn(slot.container)?.querySelectorAll("[data-dim='true']"),
      ).toHaveLength(0);
    });
    expect(
      slot
        .getByText("Merge feature")
        .closest("button")
        ?.classList.contains("opacity-40"),
    ).toBe(false);
    slot.unmount();
  });

  it("opens the uncommitted card without fetching a commit detail", async () => {
    const detailMock = vi.fn(() => detail);
    const slot = renderPanel({ ...defaultRpc(), commitDetail: detailMock });
    await slot.findByText("Merge feature");
    fireEvent.click(slot.getByText("Uncommitted changes"));
    expect(await slot.findByText("Staged")).toBeTruthy();
    expect(await slot.findByText(/read-only/u)).toBeTruthy();
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "commitDetail"),
    ).toBe(false);
    slot.unmount();
  });

  it("sends the remote toggle to history", async () => {
    const historyMock = vi.fn(() => history);
    const slot = renderPanel({ ...defaultRpc(), history: historyMock });
    await slot.findByText("Merge feature");
    historyMock.mockClear();
    fireEvent.click(slot.getByLabelText("Show remote branches"));
    await waitFor(
      () => {
        expect(historyMock).toHaveBeenCalledWith(
          expect.objectContaining({ includeRemotes: true }),
        );
      },
      { timeout: 3_000 },
    );
    slot.unmount();
  });

  it("renders the empty-repository state", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      history: () => ({ commits: [], empty: true }),
    });
    expect(
      await slot.findByText("This repository has no commits yet."),
    ).toBeTruthy();
    slot.unmount();
  });

  it("renders the no-matches state for a filtered empty page", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      history: () => ({ commits: [], empty: false }),
    });
    expect(await slot.findByText("No commits found.")).toBeTruthy();
    slot.unmount();
  });

  it("renders a history error with retry", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      history: () => {
        throw new Error("git log failed");
      },
    });
    expect(await slot.findByText("git log failed")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Retry" })).toBeTruthy();
    slot.unmount();
  });

  it("offers load more when a full page arrives", async () => {
    const page = Array.from({ length: 100 }, (_, index) =>
      commit(`h${index}aaaaaa`, `Commit ${index}`, []),
    );
    const historyMock = vi.fn(() => ({
      commits: page,
      empty: false,
    }));
    const slot = renderPanel({ ...defaultRpc(), history: historyMock });
    await slot.findByText("Commit 0");
    fireEvent.click(slot.getByRole("button", { name: "Load more" }));
    await waitFor(() => {
      expect(historyMock).toHaveBeenCalledWith(
        expect.objectContaining({ offset: 100 }),
      );
    });
    slot.unmount();
  });

  it("renders the no-repositories empty state", async () => {
    const slot = renderPanel({
      ...defaultRpc(),
      overview: () => ({
        ...overview,
        repos: [],
      }),
    });
    expect(
      await slot.findByText(
        "No Git repositories found under C:/checkouts/widgets.",
      ),
    ).toBeTruthy();
    slot.unmount();
  });

  it("preselects the project of the chat the panel was opened from", async () => {
    const secondProjects: ProjectsOutput = {
      projects: [
        ...projects.projects,
        {
          id: "proj_2",
          name: "Second",
          sources: [
            {
              id: "src_2",
              path: "C:/other/checkout",
              hostId: "host_2",
              hostName: "Laptop",
              isDefault: true,
            },
          ],
        },
      ],
    };
    writeLastProjectRoute("proj_2");
    const slot = renderPanel({
      ...defaultRpc(),
      projects: () => secondProjects,
      overview: (input) => {
        const fromSecondProject =
          typeof input === "object" &&
          input !== null &&
          "projectId" in input &&
          input.projectId === "proj_2";
        if (fromSecondProject) {
          return {
            ...overview,
            source: {
              id: "src_2",
              path: "C:/other/checkout",
              hostId: "host_2",
              hostName: "Laptop",
              isDefault: true,
            },
          };
        }
        return overview;
      },
    });
    expect(await slot.findByText("C:/other/checkout @ Laptop")).toBeTruthy();
    const overviewCalls = slot.inspection.rpcCalls.filter(
      (call) => call.method === "overview",
    );
    expect(overviewCalls[0]?.input).toMatchObject({ projectId: "proj_2" });
    slot.unmount();
  });
});

describe("project origin tracking", () => {
  it("extracts the project from chat routes only", () => {
    expect(projectFromPathname("/projects/proj_1/threads/th_1")).toBe("proj_1");
    expect(projectFromPathname("/projects/proj_1")).toBe("proj_1");
    expect(projectFromPathname("/projects/proj_1/archived")).toBe("proj_1");
    expect(projectFromPathname("/plugins/git-graph/git-graph")).toBeNull();
    expect(projectFromPathname("/threads/th_1")).toBeNull();
    expect(projectFromPathname("/")).toBeNull();
  });

  it("records the chat's project while the content script is mounted", async () => {
    window.history.pushState({}, "", "/projects/proj_chat/threads/th_9");
    const scripts = await mountPluginContentScripts(app, {
      pluginId: "git-graph",
      generation: 1,
    });
    expect(readLastProjectRoute()).toBe("proj_chat");
    await scripts.lifecycle.dispose();
    window.history.pushState({}, "", "/");
  });
});
