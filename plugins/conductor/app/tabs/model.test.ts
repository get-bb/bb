import { describe, expect, it } from "vitest";
import type { ExperimentalPanelTab } from "@get-bb/plugin-sdk/app";
import { testThread as thread } from "../testing/thread.js";
import { findDiffTabKey, tabAfterClose, workspaceChats } from "./model.js";

describe("workspaceChats", () => {
  const threads = [
    thread("later", { createdAt: 2 }),
    thread("first", { createdAt: 1 }),
    thread("other-env", { environmentId: "env-b" }),
    thread("subagent", { parentThreadId: "first" }),
    thread("side-chat", { isHidden: true }),
    thread("closed", { isArchived: true }),
  ];

  it("lists the environment's visible top-level chats oldest first", () => {
    expect(
      workspaceChats(threads, "env-a", "first").map((chat) => chat.id),
    ).toEqual(["first", "later"]);
  });

  it("keeps the open thread as a tab even when it is a sub-agent or hidden", () => {
    expect(
      workspaceChats(threads, "env-a", "side-chat").map((chat) => chat.id),
    ).toEqual(["side-chat", "first", "later"]);
  });

  it("has no tabs without an environment", () => {
    expect(workspaceChats(threads, null, "first")).toEqual([]);
  });
});

describe("findDiffTabKey", () => {
  const info: ExperimentalPanelTab = {
    key: "plugin-fixed:core:info",
    title: "Info",
    status: null,
    closable: false,
    detail: { kind: "info" },
  };
  const diff: ExperimentalPanelTab = {
    key: "plugin-fixed:bb--git:diff",
    title: "Diff",
    status: null,
    closable: false,
    detail: {
      kind: "plugin",
      pluginId: "bb--git",
      tab: { id: "diff", context: { kind: "thread" }, availability: "fixed" },
      params: null,
    },
  };

  it("finds the Git plugin's Diff tab by plugin and tab id", () => {
    expect(findDiffTabKey([info, diff])).toBe("plugin-fixed:bb--git:diff");
  });

  it("returns null when the Git plugin is off", () => {
    expect(findDiffTabKey([info])).toBeNull();
  });
});

describe("tabAfterClose", () => {
  const chats = [thread("a"), thread("b"), thread("c")];

  it("selects the tab to the right, like a browser", () => {
    expect(tabAfterClose(chats, "b")?.id).toBe("c");
  });

  it("falls back to the tab on the left when closing the last tab", () => {
    expect(tabAfterClose(chats, "c")?.id).toBe("b");
  });

  it("returns null for the only tab or an unknown one", () => {
    expect(tabAfterClose([thread("a")], "a")).toBeNull();
    expect(tabAfterClose(chats, "z")).toBeNull();
  });
});
