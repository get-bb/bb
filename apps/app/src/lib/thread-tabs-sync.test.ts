import type { ThreadTab } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { createEmptyFixedPanelTabsState } from "./fixed-panel-tabs-state";
import {
  applyThreadTabsDelta,
  deriveThreadTabsDelta,
  reconcileFixedPanelTabsState,
} from "./thread-tabs-sync";

function browserTab(id: string, title: string): ThreadTab {
  return {
    environmentId: null,
    id: `browser:${id}:none`,
    kind: "browser",
    title,
    url: `https://${id}.example.com`,
  };
}

describe("thread tab synchronization", () => {
  it("merges a local remove, update, and add without disturbing a remote add", () => {
    const first = browserTab("first", "First");
    const second = browserTab("second", "Second");
    const updatedSecond = browserTab("second", "Second updated");
    const localAddition = browserTab("local", "Local");
    const remoteAddition = browserTab("remote", "Remote");
    const delta = deriveThreadTabsDelta(
      [first, second],
      [updatedSecond, localAddition],
    );

    expect(delta).not.toBeNull();
    if (delta === null) return;
    expect(
      applyThreadTabsDelta([first, second, remoteAddition], delta),
    ).toEqual([updatedSecond, remoteAddition, localAddition]);
  });

  it("preserves a concurrent remote reorder for a metadata update", () => {
    const first = browserTab("first", "First");
    const updatedFirst = browserTab("first", "First updated");
    const second = browserTab("second", "Second");
    const delta = deriveThreadTabsDelta(
      [first, second],
      [updatedFirst, second],
    );

    expect(delta).not.toBeNull();
    if (delta === null) return;
    expect(applyThreadTabsDelta([second, first], delta)).toEqual([
      second,
      updatedFirst,
    ]);
  });

  it("preserves a concurrent remote reorder for additions and removals", () => {
    const first = browserTab("first", "First");
    const second = browserTab("second", "Second");
    const third = browserTab("third", "Third");
    const localAddition = browserTab("local", "Local");
    const remoteAddition = browserTab("remote", "Remote");
    const delta = deriveThreadTabsDelta(
      [first, second, third],
      [second, third, localAddition],
    );

    expect(delta).not.toBeNull();
    if (delta === null) return;
    expect(
      applyThreadTabsDelta([third, second, first, remoteAddition], delta),
    ).toEqual([third, second, remoteAddition, localAddition]);
  });

  it("applies an explicit local reorder and retains remote additions", () => {
    const first = browserTab("first", "First");
    const second = browserTab("second", "Second");
    const remoteAddition = browserTab("remote", "Remote");
    const delta = deriveThreadTabsDelta([first, second], [second, first]);

    expect(delta).not.toBeNull();
    if (delta === null) return;
    expect(
      applyThreadTabsDelta([first, remoteAddition, second], delta),
    ).toEqual([second, first, remoteAddition]);
  });

  it("preserves local presentation state while adopting remote tabs", () => {
    const first = browserTab("first", "First");
    const second = browserTab("second", "Second");
    const current = createEmptyFixedPanelTabsState({
      lastUsedAt: 123,
      secondary: {
        activeTabId: first.id,
        isOpen: true,
        tabs: [first],
      },
    });

    const withBoth = reconcileFixedPanelTabsState(current, [first, second]);
    expect(withBoth).toMatchObject({
      lastUsedAt: 123,
      secondary: { activeTabId: first.id, isOpen: true },
    });
    expect(withBoth.secondary.tabs).toEqual([first, second]);

    const withoutActive = reconcileFixedPanelTabsState(withBoth, [second]);
    expect(withoutActive).toMatchObject({
      lastUsedAt: 123,
      secondary: { activeTabId: null, isOpen: true },
    });
  });

  it("does not create a write for presentation-only changes", () => {
    const tab = browserTab("browser", "Browser");
    expect(deriveThreadTabsDelta([tab], [tab])).toBeNull();
  });
});
