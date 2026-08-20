import { describe, expect, it } from "vitest";
import {
  createDiffCardStateStore,
  resolveDiffCardInitialCollapsed,
} from "./diff-card-state";

describe("diff card collapse store", () => {
  it("defaults: many-file diffs and deletions start collapsed", () => {
    expect(
      resolveDiffCardInitialCollapsed({
        entry: { changeKind: "modified" },
        fileCount: 3,
      }),
    ).toBe(false);
    expect(
      resolveDiffCardInitialCollapsed({
        entry: { changeKind: "deleted" },
        fileCount: 3,
      }),
    ).toBe(true);
    expect(
      resolveDiffCardInitialCollapsed({
        entry: { changeKind: "modified" },
        fileCount: 11,
      }),
    ).toBe(true);
  });

  it("toggles from the default, scopes by identity, and drops stale slices", () => {
    const store = createDiffCardStateStore();
    const args = { entry: { changeKind: "modified" as const }, fileCount: 2 };
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    expect(store.isCollapsed("id1", "a", args)).toBe(false);
    store.toggle("id1", "a", args);
    expect(store.isCollapsed("id1", "a", args)).toBe(true);
    expect(store.isCollapsed("id2", "a", args)).toBe(false);
    expect(notified).toBe(1);
    store.setAll("id2", ["a", "b"], true);
    expect(store.isCollapsed("id2", "b", args)).toBe(true);
    // Nothing changes: no notification.
    store.setAll("id2", ["a", "b"], true);
    expect(notified).toBe(2);
    store.retainOnly("id2");
    expect(store.isCollapsed("id1", "a", args)).toBe(false);
    expect(store.isCollapsed("id2", "a", args)).toBe(true);
    expect(store.version()).toBe(3);
  });
});
