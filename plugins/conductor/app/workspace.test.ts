import { describe, expect, it } from "vitest";
import type { PluginSidebarProject } from "@get-bb/plugin-sdk/app";
import { testThread } from "./testing/thread.js";
import { findWorkspace, shortBranchName } from "./workspace.js";

const projects: PluginSidebarProject[] = [
  {
    id: "p1",
    name: "wowza",
    isPersonal: false,
    href: "/projects/p1",
    settingsHref: "/projects/p1/settings",
  },
];

describe("shortBranchName", () => {
  it("drops the branch prefix and bb's thread id suffix", () => {
    expect(shortBranchName("bb/cool-topic-thr_q9pc8biiqn")).toBe("cool-topic");
    expect(shortBranchName("feature/auth")).toBe("auth");
    expect(shortBranchName("main")).toBe("main");
  });
});

describe("findWorkspace", () => {
  it("names the workspace after its environment, falling back to the branch", () => {
    const threads = [
      testThread("a", { createdAt: 2, branchName: "bb/cool-topic-thr_a" }),
      testThread("b", { createdAt: 1, branchName: "bb/cool-topic-thr_a" }),
    ];
    const workspace = findWorkspace(threads, projects, "env-a", null);
    expect(workspace).toMatchObject({
      projectId: "p1",
      projectName: "wowza",
      label: "cool-topic",
      branchName: "bb/cool-topic-thr_a",
    });
    expect(workspace?.chats.map((chat) => chat.id)).toEqual(["b", "a"]);
  });

  it("prefers the environment name and then the checkout folder", () => {
    expect(
      findWorkspace(
        [testThread("a", { name: "Albuquerque", branchName: "bb/x" })],
        projects,
        "env-a",
        null,
      )?.label,
    ).toBe("Albuquerque");
    expect(
      findWorkspace(
        [testThread("a", { path: "/work/trees/denver/" })],
        projects,
        "env-a",
        null,
      )?.label,
    ).toBe("denver");
  });

  it("returns null for an environment with no threads", () => {
    expect(
      findWorkspace([testThread("a")], projects, "env-z", null),
    ).toBeNull();
  });
});
