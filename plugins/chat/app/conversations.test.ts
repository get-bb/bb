import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { groupConversations, listConversations } from "./conversations";

function thread(
  id: string,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    displayTitle: `Chat ${id}`,
    isHidden: false,
    isArchived: false,
    parentThreadId: null,
    updatedAt: 0,
    ...overrides,
  } as PluginSidebarThread;
}

const NOW = new Date(2026, 10, 19, 15, 0).getTime();
const HOUR = 60 * 60 * 1000;

describe("listConversations", () => {
  it("keeps top-level visible chats, most recent first", () => {
    const list = listConversations(
      [
        thread("old", { updatedAt: 1 }),
        thread("hidden", { isHidden: true, updatedAt: 5 }),
        thread("archived", { isArchived: true, updatedAt: 5 }),
        thread("child", { parentThreadId: "old", updatedAt: 5 }),
        thread("new", { updatedAt: 3 }),
      ],
      "",
    );
    expect(list.map((entry) => entry.id)).toEqual(["new", "old"]);
  });

  it("matches the search case-insensitively against the shown title", () => {
    const list = listConversations(
      [
        thread("a", { displayTitle: "Trip to Lisbon" }),
        thread("b", { displayTitle: "Tax questions" }),
      ],
      "  lisBON ",
    );
    expect(list.map((entry) => entry.id)).toEqual(["a"]);
  });
});

describe("groupConversations", () => {
  it("splits chats at local day boundaries", () => {
    const groups = groupConversations(
      [
        thread("today", { updatedAt: NOW - HOUR }),
        thread("midnight", { updatedAt: new Date(2026, 10, 19).getTime() }),
        thread("yesterday", {
          updatedAt: new Date(2026, 10, 18, 23).getTime(),
        }),
        thread("week", { updatedAt: new Date(2026, 10, 13).getTime() }),
        thread("older", { updatedAt: new Date(2026, 10, 1).getTime() }),
      ],
      NOW,
    );
    expect(
      groups.map((group) => [
        group.label,
        group.conversations.map((entry) => entry.id),
      ]),
    ).toEqual([
      ["Today", ["today", "midnight"]],
      ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["week"]],
      ["Older", ["older"]],
    ]);
  });
});
