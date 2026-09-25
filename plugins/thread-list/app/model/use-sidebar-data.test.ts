import { describe, expect, it } from "vitest";
import { makeSidebarThread } from "./fixtures.js";
import {
  buildSidebarData,
  getSidebarData,
  resetSidebarDataCacheForTest,
} from "./use-sidebar-data.js";

describe("buildSidebarData", () => {
  it("groups threads by project, resolves the personal project, and collects hosts", () => {
    const projects = [
      {
        id: "proj_a",
        name: "A",
        isPersonal: false,
        href: "/projects/proj_a",
        settingsHref: "/projects/proj_a/settings",
      },
      {
        id: "proj_me",
        name: "Personal",
        isPersonal: true,
        href: "/projects/proj_me",
        settingsHref: "/projects/proj_me/settings",
      },
    ];
    const threads = [
      makeSidebarThread({
        id: "t1",
        projectId: "proj_a",
        host: { id: "h1", name: "Mac" },
      }),
      makeSidebarThread({
        id: "t2",
        projectId: "proj_me",
        host: { id: "h2", name: "Box" },
      }),
      makeSidebarThread({
        id: "t3",
        projectId: "proj_a",
        host: { id: "h1", name: "Mac" },
      }),
      makeSidebarThread({ id: "t4", projectId: "proj_gone" }),
    ];
    const data = buildSidebarData("ready", threads, projects, [
      { id: "sec_1", name: "Later", createdAt: 1, updatedAt: 1 },
    ]);

    expect(data.status).toBe("ready");
    expect(data.sections.map((section) => section.id)).toEqual(["sec_1"]);
    expect(
      data.projects.map((project) => [
        project.id,
        project.threads.map((t) => t.id),
      ]),
    ).toEqual([
      ["proj_a", ["t1", "t3"]],
      ["proj_me", ["t2"]],
    ]);
    expect(data.projects[0]).toMatchObject({
      name: "A",
      href: "/projects/proj_a",
      settingsHref: "/projects/proj_a/settings",
      isPersonal: false,
    });
    expect(data.personalProject?.id).toBe("proj_me");
    expect([...data.hostsById.entries()]).toEqual([
      ["h1", { id: "h1", name: "Mac" }],
      ["h2", { id: "h2", name: "Box" }],
    ]);
  });

  it("reports no personal project when none is flagged", () => {
    const data = buildSidebarData("loading", [], [], []);
    expect(data.personalProject).toBeNull();
    expect(data.projects).toEqual([]);
    expect(data.hostsById.size).toBe(0);
  });
});

describe("buildSidebarData structural sharing", () => {
  const projects = [
    {
      id: "proj_a",
      name: "A",
      isPersonal: false,
      href: "/a",
      settingsHref: "/a/s",
    },
    {
      id: "proj_b",
      name: "B",
      isPersonal: false,
      href: "/b",
      settingsHref: "/b/s",
    },
  ];

  it("keeps untouched projects and their thread arrays by identity across updates", () => {
    const a1 = makeSidebarThread({ id: "a1", projectId: "proj_a" });
    const b1 = makeSidebarThread({ id: "b1", projectId: "proj_b" });
    const first = buildSidebarData("ready", [a1, b1], projects, []);
    const b1Changed = makeSidebarThread({
      id: "b1",
      projectId: "proj_b",
      title: "renamed",
    });
    const second = buildSidebarData(
      "ready",
      [a1, b1Changed],
      projects,
      [],
      [],
      first,
    );
    expect(second.projects[0]).toBe(first.projects[0]);
    expect(second.projects[0]?.threads).toBe(first.projects[0]?.threads);
    expect(second.projects[1]).not.toBe(first.projects[1]);
    expect(second.projects).not.toBe(first.projects);
    expect(second.hostsById).toBe(first.hostsById);
    const third = buildSidebarData(
      "ready",
      [a1, b1Changed],
      projects,
      [],
      [],
      second,
    );
    expect(third.projects).toBe(second.projects);
  });

  it("serves one grouped result per host payload to every caller", () => {
    resetSidebarDataCacheForTest();
    const state = {
      status: "ready" as const,
      threads: [makeSidebarThread({ id: "a1", projectId: "proj_a" })],
      experimental_hosts: [],
      projects,
      sections: [],
      experimental_archived: null,
    };
    const data = getSidebarData(state);
    expect(getSidebarData({ ...state })).toBe(data);
    expect(getSidebarData({ ...state, threads: [...state.threads] })).not.toBe(
      data,
    );
    resetSidebarDataCacheForTest();
  });
});
