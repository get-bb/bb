import { describe, expect, it } from "vitest";
import { makeSidebarThread, type SidebarThreadOverrides } from "./fixtures.js";
import {
  buildSectionThreadList,
  compareStandardThreads,
  type ThreadComparator,
} from "./project-thread-groups.js";
import {
  collapseParentThreads,
  createThreadUnreadPredicate,
  groupComparatorByReadStatus,
} from "./read-status-grouping.js";

const read = { lastReadAt: 10_000 };

function thread(id: string, overrides: SidebarThreadOverrides = {}) {
  return makeSidebarThread({
    id,
    title: id,
    latestAttentionAt: 5,
    ...overrides,
  });
}

describe("createThreadUnreadPredicate", () => {
  it("counts only threads that show an unread dot", () => {
    const isUnread = createThreadUnreadPredicate(null);

    expect(isUnread(thread("root"))).toBe(true);
    expect(isUnread(thread("error", { status: "error" }))).toBe(true);
    expect(isUnread(thread("read", read))).toBe(false);
    expect(isUnread(thread("child", { parentThreadId: "root" }))).toBe(false);
    expect(isUnread(thread("running", { status: "active" }))).toBe(false);
  });
});

describe("groupComparatorByReadStatus", () => {
  it("lists unread threads first and keeps the base order in each group", () => {
    const threads = [
      thread("read-new", { latestAttentionAt: 400, ...read }),
      thread("unread-new", { latestAttentionAt: 300 }),
      thread("read-old", { latestAttentionAt: 200, ...read }),
      thread("unread-old", { latestAttentionAt: 100 }),
    ];
    const compare = groupComparatorByReadStatus(
      compareStandardThreads,
      createThreadUnreadPredicate(null),
    );

    expect(threads.sort(compare).map(({ id }) => id)).toEqual([
      "unread-new",
      "unread-old",
      "read-new",
      "read-old",
    ]);
  });

  it("applies read status before an item comparator", () => {
    const byTitleDescending = ((left, right) =>
      right.displayTitle.localeCompare(left.displayTitle)) as ThreadComparator;
    byTitleDescending.compareItems = (left, right) =>
      left.kind === "thread" && right.kind === "thread"
        ? byTitleDescending(left.node.thread, right.node.thread)
        : 0;
    const items = buildSectionThreadList(
      [thread("alpha"), thread("zulu", read)],
      groupComparatorByReadStatus(
        byTitleDescending,
        createThreadUnreadPredicate(null),
      ),
    );

    expect(
      items.map((item) => (item.kind === "thread" ? item.node.thread.id : "")),
    ).toEqual(["alpha", "zulu"]);
  });
});

describe("collapseParentThreads", () => {
  it("collapses every parent except the expanded ones", () => {
    const threads = [
      thread("parent"),
      thread("child", { parentThreadId: "parent" }),
      thread("grandchild", { parentThreadId: "child" }),
      thread("other-parent"),
      thread("other-child", { parentThreadId: "other-parent" }),
      thread("leaf"),
    ];

    expect(
      [...collapseParentThreads(threads, ["other-parent"])].sort(),
    ).toEqual(["child", "parent"]);
  });
});
