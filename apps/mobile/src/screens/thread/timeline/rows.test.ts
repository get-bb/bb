import { createTimelineViewRowsCache } from "@bb/thread-view";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTimelineListEntries } from "./list-entries";
import {
  buildTimelineListItems,
  createTimelineListItemCache,
  createTimelineTitleCache,
  type TimelineTurnChildrenState,
} from "./rows";
import {
  assistantRow,
  commandRow,
  delegationRow,
  resetFixtureSequence,
  systemRow,
  turnRow,
  userRow,
} from "./test-fixtures";

const expandNone = () => false;

describe("buildTimelineListItems", () => {
  beforeEach(() => {
    resetFixtureSequence();
  });

  it("keys top-level items by row id and computes the per-kind discriminator", () => {
    const items = buildTimelineListItems({
      rows: [
        userRow("u1", "hello"),
        commandRow("c1", "pnpm test"),
        assistantRow("a1", "done"),
        systemRow("s1", "Failed", "details"),
      ],
      scopeActive: false,
      isExpanded: expandNone,
    });
    expect(items.map((item) => [item.key, item.kind, item.depth])).toEqual([
      ["u1", "conversation:user", 0],
      ["c1", "work:command", 0],
      ["a1", "conversation:assistant", 0],
      ["s1", "system", 0],
    ]);
    // A lone command closed by the assistant message is a closed-step leaf.
    const command = items[1];
    expect(command?.kind).toBe("work:command");
    expect(
      command?.viewRow.kind === "work" && command.viewRow.inClosedStep,
    ).toBe(true);
    expect(items[0]?.title.plain).toBe("User");
    expect(command?.title.plain).toContain("pnpm test");
    expect(items.map((item) => item.expandable)).toEqual([
      false,
      true,
      false,
      true,
    ]);
  });

  it("groups consecutive work into a step summary whose children flatten one level down only while expanded", () => {
    const rows = [
      userRow("u1", "go"),
      commandRow("c1", "ls"),
      commandRow("c2", "cat x"),
      assistantRow("a1", "ok"),
    ];
    const collapsed = buildTimelineListItems({
      rows,
      scopeActive: false,
      isExpanded: expandNone,
    });
    expect(collapsed.map((item) => item.kind)).toEqual([
      "conversation:user",
      "step-summary",
      "conversation:assistant",
    ]);
    const summary = collapsed[1];
    if (summary?.kind !== "step-summary") throw new Error("expected summary");
    expect(summary.title.plain).toMatch(/Ran 2 commands/);

    const expanded = buildTimelineListItems({
      rows,
      scopeActive: false,
      isExpanded: (rowId) => rowId === summary.row.id,
    });
    expect(
      expanded.map((item) => [item.kind, item.depth, item.parentKey]),
    ).toEqual([
      ["conversation:user", 0, null],
      ["step-summary", 0, null],
      ["work:command", 1, summary.key],
      ["work:command", 1, summary.key],
      ["conversation:assistant", 0, null],
    ]);
    expect(expanded[2]?.key).toBe(`${summary.key}>c1`);
    // Summary children are a closed scope: never active.
    expect(expanded[2]?.scopeActive).toBe(false);
  });

  it("flattens expanded delegation children with depth and keeps the nested scope active only while the delegation is pending", () => {
    const childRows = [
      commandRow("d1c1", "grep foo"),
      assistantRow("d1a1", "found it"),
    ];
    const pending = delegationRow("d1", childRows, {
      status: "pending",
      completedAt: null,
    });
    const items = buildTimelineListItems({
      rows: [userRow("u1", "search"), pending],
      scopeActive: true,
      isExpanded: (rowId) => rowId === "d1",
    });
    expect(
      items.map((item) => [item.kind, item.depth, item.scopeActive]),
    ).toEqual([
      ["conversation:user", 0, true],
      ["work:delegation", 0, true],
      ["work:command", 1, true],
      ["conversation:assistant", 1, true],
    ]);
    expect(items[2]?.key).toBe("d1>d1c1");

    const completed = buildTimelineListItems({
      rows: [userRow("u1", "search"), delegationRow("d1", childRows)],
      scopeActive: true,
      isExpanded: (rowId) => rowId === "d1",
    });
    expect(completed.slice(2).map((item) => item.scopeActive)).toEqual([
      false,
      false,
    ]);
    // Collapsed: no children items at all.
    const collapsed = buildTimelineListItems({
      rows: [userRow("u1", "search"), pending],
      scopeActive: true,
      isExpanded: expandNone,
    });
    expect(collapsed).toHaveLength(2);
  });

  it("reports lazy turn children state and flattens them once loaded", () => {
    const rows = [userRow("u1", "hi"), turnRow("t1", null)];
    const loading = buildTimelineListItems({
      rows,
      scopeActive: false,
      isExpanded: (rowId) => rowId === "t1",
      turnChildren: new Map(),
    });
    expect(loading[1]?.kind).toBe("turn");
    expect(loading[1]?.lazyChildren).toBe("loading");
    expect(loading).toHaveLength(2);

    const errored = buildTimelineListItems({
      rows,
      scopeActive: false,
      isExpanded: (rowId) => rowId === "t1",
      turnChildren: new Map<string, TimelineTurnChildrenState>([
        ["t1", { status: "error" }],
      ]),
    });
    expect(errored[1]?.lazyChildren).toBe("error");

    const loaded = buildTimelineListItems({
      rows,
      scopeActive: false,
      isExpanded: (rowId) => rowId === "t1",
      turnChildren: new Map<string, TimelineTurnChildrenState>([
        [
          "t1",
          {
            status: "loaded",
            rows: [
              commandRow("t1c1", "pnpm build"),
              commandRow("t1c2", "pnpm test"),
              assistantRow("t1a1", "All green"),
            ],
          },
        ],
      ]),
    });
    expect(loaded[1]?.lazyChildren).toBe("loaded");
    // Lazy children are a closed scope: trailing work collapses into a
    // step-summary like the web's lazy turn body.
    expect(loaded.slice(2).map((item) => [item.kind, item.depth])).toEqual([
      ["step-summary", 1],
      ["conversation:assistant", 1],
    ]);
    // Collapsed turn rows report no lazy state.
    const collapsed = buildTimelineListItems({
      rows,
      scopeActive: false,
      isExpanded: expandNone,
    });
    expect(collapsed[1]?.lazyChildren).toBeNull();
  });

  it("keeps the title object for unchanged rows across rebuilds and rebuilds it when the active-bundle status flips", () => {
    const rows = [
      userRow("u1", "go"),
      commandRow("c1", "ls", { status: "pending", completedAt: null }),
      commandRow("c2", "cat x", { status: "pending", completedAt: null }),
    ];
    const titleCache = createTimelineTitleCache();
    const cache = createTimelineViewRowsCache();
    const first = buildTimelineListItems({
      rows,
      scopeActive: true,
      isExpanded: expandNone,
      cache,
      titleCache,
    });
    const second = buildTimelineListItems({
      rows,
      scopeActive: true,
      isExpanded: expandNone,
      cache,
      titleCache,
    });
    expect(first[0]?.title).toBe(second[0]?.title);
    expect(first[1]?.kind).toBe("bundle-summary");
    expect(first[1]?.title).toBe(second[1]?.title);
    // The trailing bundle in an active scope reads present tense; once the
    // scope settles it is rebuilt in the past tense.
    expect(first[1]?.title.plain).toMatch(/^Running/);
    const settled = buildTimelineListItems({
      rows,
      scopeActive: false,
      isExpanded: expandNone,
      cache,
      titleCache,
    });
    expect(settled[1]?.title).not.toBe(first[1]?.title);
    expect(settled[1]?.title.plain).toMatch(/^Ran/);
  });
  it("keeps item identity for untouched rows across rebuilds and replaces only what changed", () => {
    const rows = [
      userRow("u1", "go"),
      commandRow("c1", "ls"),
      commandRow("c2", "cat x"),
      assistantRow("a1", "ok"),
    ];
    const cache = createTimelineViewRowsCache();
    const titleCache = createTimelineTitleCache();
    const itemCache = createTimelineListItemCache();
    const build = (
      nextRows: typeof rows,
      isExpanded: (rowId: string) => boolean,
    ) =>
      buildTimelineListItems({
        rows: nextRows,
        scopeActive: false,
        isExpanded,
        cache,
        titleCache,
        itemCache,
      });
    const first = build(rows, expandNone);
    const second = build(rows, expandNone);
    expect(second).toHaveLength(3);
    second.forEach((item, index) => expect(item).toBe(first[index]));

    // Expanding the summary replaces the summary item (its `expanded` flag)
    // and adds its children; the neighbours keep their identity.
    const summary = first[1];
    if (summary?.kind !== "step-summary") throw new Error("expected summary");
    const expanded = build(rows, (rowId) => rowId === summary.row.id);
    expect(expanded[0]).toBe(first[0]);
    expect(expanded[1]).not.toBe(first[1]);
    expect(expanded[1]?.expanded).toBe(true);
    expect(expanded[2]?.parentKind).toBe("step-summary");
    expect(expanded[4]).toBe(first[2]);

    // A streaming update to the last row replaces that item; leaf rows keep
    // their identity (summary rows are re-projected by thread-view per rows
    // array and are cheap headers, so they are allowed to change).
    const streamed = [...rows.slice(0, 3), assistantRow("a1", "ok, done")];
    const third = build(streamed, (rowId) => rowId === summary.row.id);
    expect(third[0]).toBe(expanded[0]);
    expect(third[2]).toBe(expanded[2]);
    expect(third[3]).toBe(expanded[3]);
    expect(third[4]).not.toBe(expanded[4]);
    expect(
      third[4]?.kind === "conversation:assistant" && third[4].row.text,
    ).toBe("ok, done");
    // Items that left the list are not retained.
    expect(itemCache.current.size).toBe(third.length);
  });
});

describe("buildTimelineListEntries", () => {
  beforeEach(() => {
    resetFixtureSequence();
  });

  it("inserts the unread divider before the first non-user row after the cutoff", () => {
    const items = buildTimelineListItems({
      rows: [
        userRow("u1", "old"), // createdAt 1001
        assistantRow("a1", "old reply"), // 1002
        userRow("u2", "new question"), // 1003 (user-authored: skipped)
        assistantRow("a2", "new reply"), // 1004
      ],
      scopeActive: false,
      isExpanded: expandNone,
    });
    const { entries, unreadDividerIndex } = buildTimelineListEntries(items, {
      kind: "after-cutoff",
      cutoffAt: 1_002,
    });
    expect(unreadDividerIndex).toBe(3);
    expect(entries.map((entry) => entry.key)).toEqual([
      "u1",
      "a1",
      "u2",
      "thread-unread-divider",
      "a2",
    ]);
    expect(buildTimelineListEntries(items, null).unreadDividerIndex).toBe(-1);
    expect(
      buildTimelineListEntries(items, { kind: "before-first" })
        .unreadDividerIndex,
    ).toBe(0);
  });
});
