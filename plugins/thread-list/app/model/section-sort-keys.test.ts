import { describe, expect, it } from "vitest";
import { getSidebarThreadComparator } from "../list/ProjectList.js";
import { makeSidebarThread, type SidebarThreadOverrides } from "./fixtures.js";
import {
  buildSectionThreadList,
  type ProjectThreadItem,
} from "./project-thread-groups.js";
import {
  createThreadUnreadPredicate,
  groupComparatorByReadStatus,
} from "./read-status-grouping.js";
import {
  findSortKeyedSectionIds,
  readSidebarSortKey,
  sortKeyedSectionsSoonestFirst,
  type SidebarSortKeys,
} from "./section-sort-keys.js";
import type { SidebarThread } from "./sidebar-thread.js";

const read = { lastReadAt: 10_000 };
const sections = [
  { id: "calendar", name: "Calendar" },
  { id: "work", name: "Work" },
];

function thread(id: string, overrides: SidebarThreadOverrides = {}) {
  return makeSidebarThread({
    id,
    title: id,
    latestAttentionAt: 5,
    originPluginId: "calendar-plugin",
    sectionId: "calendar",
    ...overrides,
  });
}

function sidebarComparator() {
  return groupComparatorByReadStatus(
    getSidebarThreadComparator("updated"),
    createThreadUnreadPredicate(null),
  );
}

function sectionThreadIds(
  items: readonly ProjectThreadItem[],
  sectionId: string | null,
): string[] {
  const scoped =
    sectionId === null
      ? items.filter((item) => item.kind !== "section")
      : items.flatMap((item) =>
          item.kind === "section" && item.group.id === sectionId
            ? item.group.items
            : [],
        );
  return scoped.map((item) =>
    item.kind === "thread" ? item.node.thread.id : item.kind,
  );
}

function buildWithSortKeys(
  threads: readonly SidebarThread[],
  sortKeys: SidebarSortKeys,
  comparator = sidebarComparator(),
) {
  return buildSectionThreadList(
    threads,
    sortKeyedSectionsSoonestFirst(
      comparator,
      sortKeys,
      findSortKeyedSectionIds(threads, sortKeys),
    ),
    sections,
  );
}

describe("readSidebarSortKey", () => {
  it("accepts only finite numbers", () => {
    expect(readSidebarSortKey({ sidebarSortKey: 1_700_000_000_000 })).toBe(
      1_700_000_000_000,
    );
    expect(readSidebarSortKey({ sidebarSortKey: "1" })).toBeNull();
    expect(readSidebarSortKey({ sidebarSortKey: null })).toBeNull();
    expect(readSidebarSortKey({})).toBeNull();
  });
});

describe("sortKeyedSectionsSoonestFirst", () => {
  it("orders a fully keyed section soonest first over running, unread, and recency", () => {
    const threads = [
      thread("later-running", { status: "active", latestAttentionAt: 900 }),
      thread("soonest-read", { latestAttentionAt: 100, ...read }),
      thread("middle-unread", { latestAttentionAt: 800 }),
    ];
    const sortKeys = new Map([
      ["later-running", 3_000],
      ["soonest-read", 1_000],
      ["middle-unread", 2_000],
    ]);

    expect(
      sectionThreadIds(buildWithSortKeys(threads, sortKeys), "calendar"),
    ).toEqual(["soonest-read", "middle-unread", "later-running"]);
  });

  it("ignores the global sort direction and field in a keyed section", () => {
    const threads = [thread("b-late"), thread("a-early")];
    const sortKeys = new Map([
      ["b-late", 2_000],
      ["a-early", 1_000],
    ]);

    for (const comparator of [
      getSidebarThreadComparator("alpha", "descending"),
      getSidebarThreadComparator("created", "ascending"),
    ]) {
      expect(
        sectionThreadIds(
          buildWithSortKeys(threads, sortKeys, comparator),
          "calendar",
        ),
      ).toEqual(["a-early", "b-late"]);
    }
  });

  it("keeps today's order when a section has a thread without a key", () => {
    const threads = [
      thread("keyed-late", { latestAttentionAt: 300 }),
      thread("unkeyed", { latestAttentionAt: 200, originPluginId: null }),
      thread("keyed-early", { latestAttentionAt: 100 }),
    ];
    const sortKeys = new Map([
      ["keyed-late", 3_000],
      ["keyed-early", 1_000],
    ]);

    expect(findSortKeyedSectionIds(threads, sortKeys)).toEqual(new Set());
    expect(
      sectionThreadIds(buildWithSortKeys(threads, sortKeys), "calendar"),
    ).toEqual(["keyed-late", "unkeyed", "keyed-early"]);
  });

  it("leaves other sections and loose threads in today's order", () => {
    const threads = [
      thread("event-late"),
      thread("event-early"),
      thread("work-old", { sectionId: "work", latestAttentionAt: 100 }),
      thread("work-new", { sectionId: "work", latestAttentionAt: 200 }),
      thread("loose-old", { sectionId: null, latestAttentionAt: 100 }),
      thread("loose-new", { sectionId: null, latestAttentionAt: 200 }),
    ];
    const sortKeys = new Map([
      ["event-late", 2_000],
      ["event-early", 1_000],
    ]);

    const items = buildWithSortKeys(threads, sortKeys);

    expect(sectionThreadIds(items, "calendar")).toEqual([
      "event-early",
      "event-late",
    ]);
    expect(sectionThreadIds(items, "work")).toEqual(["work-new", "work-old"]);
    expect(sectionThreadIds(items, null)).toEqual(["loose-new", "loose-old"]);
  });

  it("does not let nested child threads turn the section's sort off", () => {
    const threads = [
      thread("event-late"),
      thread("event-early"),
      thread("child", { parentThreadId: "event-late", originPluginId: null }),
    ];
    const sortKeys = new Map([
      ["event-late", 2_000],
      ["event-early", 1_000],
    ]);

    expect(findSortKeyedSectionIds(threads, sortKeys)).toEqual(
      new Set(["calendar"]),
    );
    expect(
      sectionThreadIds(buildWithSortKeys(threads, sortKeys), "calendar"),
    ).toEqual(["event-early", "event-late"]);
  });

  it("returns the comparator unchanged when no section is keyed", () => {
    const comparator = sidebarComparator();
    expect(
      sortKeyedSectionsSoonestFirst(comparator, new Map(), new Set()),
    ).toBe(comparator);
  });
});
