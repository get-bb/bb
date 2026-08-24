import { NO_MACHINE_GROUP_KEY } from "@bb/client-core";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { buildSidebarModel } from "@/data/sidebar/sidebar-model";
import { resolveSidebarSectionOrder } from "@/data/sidebar/sidebar-section-order";
import {
  host,
  project,
  sidebarBootstrap,
  threadListEntry,
} from "@/data/test/fixtures";
import {
  buildSidebarListRows as buildRows,
  getHeaderCollapseTarget,
  resolveThreadRowIndicator,
  type SidebarCollapsedState,
  type SidebarListRow,
} from "./sidebar-list-rows";

type BuildRowsArgs = Parameters<typeof buildRows>[0];

/** The rows in the model's natural section order (no stored order). */
function buildSidebarListRows(
  args: Omit<BuildRowsArgs, "sectionOrder"> &
    Partial<Pick<BuildRowsArgs, "sectionOrder">>,
): SidebarListRow[] {
  return buildRows({
    sectionOrder: resolveSidebarSectionOrder(args.model, []),
    ...args,
  });
}

function collapsedState(
  overrides: Partial<SidebarCollapsedState> = {},
): SidebarCollapsedState {
  return {
    projectIds: new Set(),
    threadIds: new Set(),
    environmentIds: new Set(),
    sectionKeys: new Set(),
    machineKeys: new Set(),
    builtInSections: new Set(),
    ...overrides,
  };
}

function rowKeys(rows: SidebarListRow[]): string[] {
  return rows.map((row) => row.key);
}

const bootstrap = sidebarBootstrap({
  sections: [{ id: "sec_a", name: "Alpha", createdAt: 1, updatedAt: 1 }],
  projects: [
    project({
      id: "proj_1",
      name: "One",
      threads: [
        threadListEntry({
          id: "t_root",
          createdAt: 5,
          lastReadAt: 50,
          latestAttentionAt: 50,
        }),
        threadListEntry({
          id: "t_child",
          parentThreadId: "t_root",
          createdAt: 6,
          // Blocked on the user: the collapsed parent must surface it.
          hasPendingInteraction: true,
        }),
        threadListEntry({
          id: "t_pinned",
          pinnedAt: 100,
          createdAt: 3,
          latestAttentionAt: 30,
        }),
        threadListEntry({
          id: "t_wt_a",
          environmentId: "env_1",
          environmentBranchName: "feature/x",
          environmentWorkspaceDisplayKind: "managed-worktree",
          environmentHostId: "host_1",
          createdAt: 2,
          latestAttentionAt: 20,
        }),
        threadListEntry({
          id: "t_wt_b",
          environmentId: "env_1",
          environmentBranchName: "feature/x",
          environmentWorkspaceDisplayKind: "managed-worktree",
          environmentHostId: "host_1",
          createdAt: 1,
          latestAttentionAt: 10,
        }),
        threadListEntry({
          id: "t_sec",
          sectionId: "sec_a",
          createdAt: 4,
          lastReadAt: 40,
          latestAttentionAt: 40,
        }),
      ],
    }),
    project({ id: "proj_2", name: "Two (empty)" }),
  ],
});

describe("buildSidebarListRows", () => {
  it("returns nothing before the bootstrap has loaded", () => {
    const model = buildSidebarModel({
      bootstrap: undefined,
      hosts: [],
      organize: "project",
      sort: "updated",
    });
    expect(
      buildSidebarListRows({ model, collapsed: collapsedState() }),
    ).toEqual([]);
  });

  it("renders pinned first, then project headers with nested threads, environments and an empty placeholder", () => {
    const model = buildSidebarModel({
      bootstrap,
      hosts: [],
      organize: "project",
      sort: "updated",
    });
    const rows = buildSidebarListRows({ model, collapsed: collapsedState() });
    expect(rowKeys(rows)).toEqual([
      "header:pinned",
      "thread:t_pinned",
      "header:project:proj_1",
      "thread:t_root",
      "thread:t_child",
      "thread:t_sec",
      "environment:env_1",
      "thread:t_wt_a",
      "thread:t_wt_b",
      "header:project:proj_2",
      "empty:project:proj_2",
    ]);
    const child = rows.find((row) => row.key === "thread:t_child");
    expect(child).toMatchObject({ type: "thread", depth: 1 });
    const env = rows.find((row) => row.key === "environment:env_1");
    expect(env).toMatchObject({
      type: "environment",
      label: "feature/x",
      threadCount: 2,
      depth: 0,
    });
    const worktreeThread = rows.find((row) => row.key === "thread:t_wt_a");
    expect(worktreeThread).toMatchObject({
      depth: 1,
    });
    // The personal "Threads" bucket is empty and there are other groups: hidden.
    expect(rowKeys(rows)).not.toContain("header:threads");
  });

  it("hides children of a collapsed parent and rolls their status into the parent glyph", () => {
    const model = buildSidebarModel({
      bootstrap,
      hosts: [],
      organize: "project",
      sort: "updated",
    });
    const rows = buildSidebarListRows({
      model,
      collapsed: collapsedState({ threadIds: new Set(["t_root"]) }),
    });
    expect(rowKeys(rows)).not.toContain("thread:t_child");
    const parent = rows.find((row) => row.key === "thread:t_root");
    expect(parent).toMatchObject({
      type: "thread",
      childCount: 1,
      collapsed: true,
      indicator: "waiting-for-input",
    });
    // Expanded, the parent only shows its own (read) state.
    const expanded = buildSidebarListRows({
      model,
      collapsed: collapsedState(),
    }).find((row) => row.key === "thread:t_root");
    expect(expanded).toMatchObject({ collapsed: false, indicator: "none" });
  });

  it("collapses environments, projects and built-in sections through their persisted ids", () => {
    const model = buildSidebarModel({
      bootstrap,
      hosts: [],
      organize: "project",
      sort: "updated",
    });
    const rows = buildSidebarListRows({
      model,
      collapsed: collapsedState({
        environmentIds: new Set(["env_1"]),
        projectIds: new Set(["proj_2"]),
        builtInSections: new Set(["pinned"]),
      }),
    });
    expect(rowKeys(rows)).toEqual([
      "header:pinned",
      "header:project:proj_1",
      "thread:t_root",
      "thread:t_child",
      "thread:t_sec",
      "environment:env_1",
      "header:project:proj_2",
    ]);
    const pinnedHeader = rows[0];
    expect(pinnedHeader).toMatchObject({
      type: "header",
      collapsed: true,
      threadCount: 1,
    });
    if (pinnedHeader.type !== "header") throw new Error("expected header");
    expect(getHeaderCollapseTarget(pinnedHeader)).toEqual({
      kind: "builtIn",
      id: "pinned",
    });
    const projectHeader = rows.at(-1);
    if (projectHeader?.type !== "header") throw new Error("expected header");
    expect(getHeaderCollapseTarget(projectHeader)).toEqual({
      kind: "project",
      id: "proj_2",
    });
  });

  it("manual mode lists sections (empty ones included) then Unorganized, keyed by section key", () => {
    const model = buildSidebarModel({
      bootstrap: sidebarBootstrap({
        sections: [
          { id: "sec_a", name: "Alpha", createdAt: 1, updatedAt: 1 },
          { id: "sec_empty", name: "Empty", createdAt: 1, updatedAt: 1 },
        ],
        projects: [
          project({
            id: "proj_1",
            threads: [
              threadListEntry({ id: "t_loose" }),
              threadListEntry({ id: "t_sec", sectionId: "sec_a" }),
            ],
          }),
        ],
      }),
      hosts: [],
      organize: "manual",
      sort: "updated",
    });
    const rows = buildSidebarListRows({
      model,
      collapsed: collapsedState({
        sectionKeys: new Set(["chronological::sec_a"]),
      }),
    });
    expect(rowKeys(rows)).toEqual([
      "header:section:sec_a",
      "header:section:sec_empty",
      "empty:section:sec_empty",
      "header:threads",
      "thread:t_loose",
    ]);
    const header = rows[0];
    if (header.type !== "header") throw new Error("expected header");
    expect(getHeaderCollapseTarget(header)).toEqual({
      kind: "section",
      id: "chronological::sec_a",
    });
    expect(header.label).toBe("Alpha");
  });

  it("machine mode keys headers by host id and the no-machine bucket", () => {
    const model = buildSidebarModel({
      bootstrap: sidebarBootstrap({
        projects: [
          project({
            id: "proj_1",
            threads: [
              threadListEntry({ id: "t_host", environmentHostId: "host_1" }),
              threadListEntry({ id: "t_none" }),
            ],
          }),
        ],
      }),
      hosts: [host({ id: "host_1", name: "Laptop" })],
      organize: "machine",
      sort: "updated",
    });
    const rows = buildSidebarListRows({
      model,
      collapsed: collapsedState({
        machineKeys: new Set([NO_MACHINE_GROUP_KEY]),
      }),
    });
    expect(rowKeys(rows)).toEqual([
      "header:machine:host_1",
      "thread:t_host",
      `header:machine:${NO_MACHINE_GROUP_KEY}`,
    ]);
    const header = rows[0];
    if (header.type !== "header") throw new Error("expected header");
    expect(header.label).toBe("Laptop");
    expect(getHeaderCollapseTarget(header)).toEqual({
      kind: "machine",
      id: "host_1",
    });
  });

  it("keeps the Threads bucket when it is the only group, even while empty", () => {
    const model = buildSidebarModel({
      bootstrap: sidebarBootstrap(),
      hosts: [],
      organize: "project",
      sort: "updated",
    });
    const rows = buildSidebarListRows({ model, collapsed: collapsedState() });
    expect(rowKeys(rows)).toEqual(["header:threads", "empty:threads"]);
  });
});

describe("resolveThreadRowIndicator", () => {
  const childActivity = {
    pending: true,
    working: false,
    hasUnsubmittedDraft: false,
    runtimeWorking: false,
    workflow: false,
    backgroundAgent: false,
    backgroundCommand: false,
    planMode: false,
    goal: false,
    unread: false,
    unreadError: false,
  };

  it("lets a hidden child's pending interaction win over the parent's own idle state", () => {
    const thread = threadListEntry({ id: "t" });
    expect(
      resolveThreadRowIndicator({
        thread,
        hasHiddenChildren: true,
        childActivity,
      }),
    ).toBe("waiting-for-input");
    expect(
      resolveThreadRowIndicator({
        thread,
        hasHiddenChildren: false,
        childActivity,
      }),
    ).toBe("none");
  });

  it("ranks the parent's own unread error above hidden child activity", () => {
    const thread = threadListEntry({
      id: "t",
      status: "error",
      lastReadAt: null,
      latestAttentionAt: 5,
    });
    expect(
      resolveThreadRowIndicator({
        thread,
        hasHiddenChildren: true,
        childActivity,
      }),
    ).toBe("unread-error");
  });

  it("shows the spinner for a running thread", () => {
    const thread = threadListEntry({
      id: "t",
      status: "active",
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });
    expect(
      resolveThreadRowIndicator({
        thread,
        hasHiddenChildren: false,
        childActivity,
      }),
    ).toBe("runtime");
  });
});

describe("buildSidebarListRows section order", () => {
  it("emits top-level sections in the stored order and keeps unknown ones after", () => {
    const model = buildSidebarModel({
      bootstrap: sidebarBootstrap({
        projects: [
          project({
            id: "proj_1",
            name: "One",
            threads: [threadListEntry({ id: "t_pinned", pinnedAt: 100 })],
          }),
          project({
            id: "proj_2",
            name: "Two",
            threads: [threadListEntry({ id: "t_two", projectId: "proj_2" })],
          }),
        ],
        personalProject: project({
          id: PERSONAL_PROJECT_ID,
          kind: "personal",
          name: "Personal",
          threads: [
            threadListEntry({
              id: "t_personal",
              projectId: PERSONAL_PROJECT_ID,
            }),
          ],
        }),
      }),
      hosts: [],
      organize: "project",
      sort: "updated",
    });
    const headers = (order: readonly string[]) =>
      buildRows({
        model,
        collapsed: collapsedState(),
        sectionOrder: resolveSidebarSectionOrder(model, order),
      })
        .filter((row) => row.type === "header")
        .map((row) => row.key);
    // Threads moved above the projects; Pinned stays first by default.
    expect(headers(["threads", "project:proj_2", "project:proj_1"])).toEqual([
      "header:pinned",
      "header:threads",
      "header:project:proj_2",
      "header:project:proj_1",
    ]);
    // Pinned can move too, and a section the order never named joins right
    // after the last entity section the order does name.
    expect(headers(["project:proj_2", "pinned", "threads"])).toEqual([
      "header:project:proj_2",
      "header:project:proj_1",
      "header:pinned",
      "header:threads",
    ]);
  });
});
