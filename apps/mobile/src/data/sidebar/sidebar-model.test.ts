import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  host,
  project,
  sidebarBootstrap,
  threadListEntry,
} from "../test/fixtures";
import {
  buildSidebarModel,
  getSelectedThreadSidebarExpansion,
  getSidebarThreadComparator,
  type SidebarGroup,
} from "./sidebar-model";

function groupThreadIds(group: SidebarGroup | undefined): string[] {
  return group?.threads.map((thread) => thread.id) ?? [];
}

function rootItemIds(group: SidebarGroup | undefined): string[] {
  return (group?.items ?? []).map((item) => {
    switch (item.kind) {
      case "thread":
        return item.node.thread.id;
      case "environment":
        return `env:${item.group.environmentId}`;
      case "section":
        return `section:${item.group.id}`;
    }
  });
}

const bootstrap = sidebarBootstrap({
  sections: [
    { id: "sec_b", name: "Beta", createdAt: 1, updatedAt: 1 },
    { id: "sec_a", name: "Alpha", createdAt: 1, updatedAt: 1 },
  ],
  projects: [
    project({
      id: "proj_1",
      name: "One",
      threads: [
        threadListEntry({ id: "t_root", createdAt: 5, latestAttentionAt: 50 }),
        threadListEntry({
          id: "t_pinned",
          pinnedAt: 100,
          createdAt: 3,
          latestAttentionAt: 30,
        }),
        threadListEntry({
          id: "t_pinned_child",
          parentThreadId: "t_pinned",
          createdAt: 4,
        }),
        threadListEntry({ id: "t_hidden", visibility: "hidden", createdAt: 9 }),
        threadListEntry({
          id: "t_sec_a",
          sectionId: "sec_a",
          createdAt: 2,
          latestAttentionAt: 20,
          environmentHostId: "host_1",
        }),
      ],
    }),
    project({
      id: "proj_2",
      name: "Two",
      threads: [
        // A child living in another project than its parent.
        threadListEntry({
          id: "t_cross_child",
          projectId: "proj_2",
          parentThreadId: "t_root",
          createdAt: 6,
          environmentHostId: "host_1",
        }),
        threadListEntry({
          id: "t_two",
          projectId: "proj_2",
          createdAt: 7,
          latestAttentionAt: 70,
          environmentHostId: "host_2",
        }),
      ],
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
        createdAt: 8,
        latestAttentionAt: 80,
      }),
    ],
  }),
});

describe("buildSidebarModel", () => {
  it("is empty but typed before the bootstrap loads", () => {
    const model = buildSidebarModel({
      bootstrap: undefined,
      hosts: undefined,
      organize: "project",
      sort: "updated",
    });
    expect(model.isReady).toBe(false);
    expect(model.groups).toEqual([]);
    expect(model.pinned).toBeNull();
  });

  it("project mode: one group per project plus personal Threads; pinned roots and their children leave the groups; cross-project children follow their parent; hidden threads never render", () => {
    const model = buildSidebarModel({
      bootstrap,
      hosts: [],
      organize: "project",
      sort: "updated",
    });
    expect(model.isReady).toBe(true);
    expect(model.groups.map((group) => group.id)).toEqual([
      "project:proj_1",
      "project:proj_2",
      "threads",
    ]);
    expect(model.pinned?.rootNodes.map((node) => node.thread.id)).toEqual([
      "t_pinned",
    ]);
    expect(model.pinned?.threads.map((thread) => thread.id).sort()).toEqual([
      "t_pinned",
      "t_pinned_child",
    ]);
    const [projectOne, projectTwo, personal] = model.groups;
    expect(groupThreadIds(projectOne).sort()).toEqual([
      "t_cross_child",
      "t_root",
      "t_sec_a",
    ]);
    // Only roots at the top level; the cross-project child nests under t_root.
    expect(rootItemIds(projectOne)).toEqual(["t_root", "t_sec_a"]);
    expect(groupThreadIds(projectTwo)).toEqual(["t_two"]);
    expect(personal.kind).toBe("threads");
    expect(personal.label).toBe("Threads");
    expect(groupThreadIds(personal)).toEqual(["t_personal"]);
    expect(model.projectNamesById.get(PERSONAL_PROJECT_ID)).toBe("Personal");
    expect(model.sectionNamesById.get("sec_a")).toBe("Alpha");
  });

  it("machine mode: groups follow the host list, unknown hosts and machineless threads trail; no hosts at all falls back to one Threads group", () => {
    const model = buildSidebarModel({
      bootstrap,
      hosts: [host({ id: "host_2", name: "Laptop" })],
      organize: "machine",
      sort: "updated",
    });
    expect(
      model.groups.map((group) => [
        group.id,
        group.label,
        groupThreadIds(group).sort(),
      ]),
    ).toEqual([
      ["machine:host_2", "Laptop", ["t_two"]],
      ["machine:host_1", "Unknown machine", ["t_cross_child", "t_sec_a"]],
      ["machine:no-machine", "No machine", ["t_personal", "t_root"]],
    ]);

    const empty = buildSidebarModel({
      bootstrap: sidebarBootstrap(),
      hosts: [host({ id: "host_2" })],
      organize: "machine",
      sort: "updated",
    });
    expect(empty.groups.map((group) => group.id)).toEqual(["threads"]);
  });

  it("manual mode: one group per section in server order (empty ones included) then Unorganized with the loose roots", () => {
    const model = buildSidebarModel({
      bootstrap,
      hosts: [],
      organize: "manual",
      sort: "updated",
    });
    expect(model.groups.map((group) => [group.id, group.label])).toEqual([
      ["section:sec_b", "Beta"],
      ["section:sec_a", "Alpha"],
      ["threads", "Unorganized"],
    ]);
    const [beta, alpha, loose] = model.groups;
    expect(groupThreadIds(beta)).toEqual([]);
    expect(groupThreadIds(alpha)).toEqual(["t_sec_a"]);
    expect(alpha.kind === "section" && alpha.sectionKey).toBe(
      "chronological::sec_a",
    );
    // Sorted by attention recency: personal (80), two (70), root (50).
    expect(rootItemIds(loose)).toEqual(["t_personal", "t_two", "t_root"]);
    expect(groupThreadIds(loose)).toContain("t_cross_child");
  });

  it("alpha sort orders siblings (and sections) by display title", () => {
    const compare = getSidebarThreadComparator("alpha");
    const model = buildSidebarModel({
      bootstrap: sidebarBootstrap({
        sections: [
          { id: "s_z", name: "Zulu", createdAt: 1, updatedAt: 1 },
          { id: "s_a", name: "Alpha", createdAt: 1, updatedAt: 1 },
        ],
        projects: [
          project({
            id: "p",
            threads: [
              threadListEntry({
                id: "b",
                title: "banana",
                latestAttentionAt: 3,
              }),
              threadListEntry({
                id: "a",
                title: "Apple",
                latestAttentionAt: 1,
              }),
              threadListEntry({
                id: "c",
                title: null,
                titleFallback: "cherry",
              }),
            ],
          }),
        ],
      }),
      hosts: [],
      organize: "manual",
      sort: "alpha",
    });
    expect(model.compareThreads).toBe(compare);
    expect(model.groups.map((group) => group.label)).toEqual([
      "Alpha",
      "Zulu",
      "Unorganized",
    ]);
    expect(rootItemIds(model.groups[2])).toEqual(["a", "b", "c"]);
  });

  it("created sort is strict creation order regardless of activity", () => {
    const model = buildSidebarModel({
      bootstrap: sidebarBootstrap({
        projects: [
          project({
            id: "p",
            threads: [
              threadListEntry({
                id: "old-active",
                projectId: "p",
                status: "active",
                createdAt: 1,
              }),
              threadListEntry({
                id: "new",
                projectId: "p",
                createdAt: 9,
                latestAttentionAt: 1,
              }),
              threadListEntry({
                id: "mid",
                projectId: "p",
                createdAt: 5,
                latestAttentionAt: 99,
              }),
            ],
          }),
        ],
      }),
      hosts: [],
      organize: "project",
      sort: "created",
    });
    expect(rootItemIds(model.groups[0])).toEqual(["new", "mid", "old-active"]);
  });
});

describe("getSelectedThreadSidebarExpansion", () => {
  const model = buildSidebarModel({
    bootstrap,
    hosts: [host({ id: "host_1", name: "Desk" })],
    organize: "machine",
    sort: "updated",
  });

  it("walks the parent chain and names the containing group", () => {
    expect(getSelectedThreadSidebarExpansion(model, "t_cross_child")).toEqual({
      threadIds: ["t_root"],
      environmentIds: [],
      projectId: null,
      machineKey: "host_1",
      sectionKey: null,
      builtInSection: null,
    });
    expect(
      getSelectedThreadSidebarExpansion(model, "t_pinned_child"),
    ).toMatchObject({
      threadIds: ["t_pinned"],
      builtInSection: "pinned",
      machineKey: null,
    });
  });

  it("returns null for unknown or hidden threads", () => {
    expect(getSelectedThreadSidebarExpansion(model, "nope")).toBeNull();
    expect(getSelectedThreadSidebarExpansion(model, "t_hidden")).toBeNull();
  });
});
