// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  makeSidebarEnvironment,
  makeSidebarThread,
  type SidebarThreadOverrides,
} from "../model/fixtures.js";
import {
  collapsedEnvironmentIdsAtom,
  collapsedSidebarSectionIdsAtom,
  collapsedThreadIdsAtom,
  sidebarCollapsedThreadSectionsAtom,
  sidebarOrganizationModeAtom,
} from "../preferences/atoms.js";
import {
  useSidebarThreadRevealCore,
  type SidebarThreadRevealInputs,
} from "./useSidebarThreadReveal.js";

afterEach(cleanup);

function thread(id: string, overrides: SidebarThreadOverrides = {}) {
  return makeSidebarThread({
    id,
    projectId: "proj_personal",
    sectionId: id,
    lastReadAt: 1,
    latestAttentionAt: 1,
    ...overrides,
  });
}

function setup(
  threads: SidebarThread[],
  initial: Partial<SidebarThreadRevealInputs> = {},
) {
  const store = createStore();
  store.set(sidebarOrganizationModeAtom, "chronological");
  store.set(sidebarCollapsedThreadSectionsAtom, [
    "chronological::first",
    "chronological::second",
    "chronological::third",
  ]);
  function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  }
  const hook = renderHook<void, SidebarThreadRevealInputs>(
    (inputs) => useSidebarThreadRevealCore(inputs),
    {
      wrapper: Wrapper,
      initialProps: {
        selectedThreadId: "first",
        threads,
        threadsReady: true,
        preferencesReady: true,
        personalProjectId: "proj_personal",
        ...initial,
      },
    },
  );
  const current: SidebarThreadRevealInputs = {
    selectedThreadId: "first",
    threads,
    threadsReady: true,
    preferencesReady: true,
    personalProjectId: "proj_personal",
    ...initial,
  };
  const update = (next: Partial<SidebarThreadRevealInputs>) => {
    Object.assign(current, next);
    hook.rerender({ ...current });
  };
  return { ...hook, store, update };
}

describe("useSidebarThreadReveal", () => {
  it("requires leaving and returning before revealing a manually collapsed open thread", () => {
    const { store, update } = setup([thread("first"), thread("second")]);
    act(() =>
      store.set(sidebarCollapsedThreadSectionsAtom, ["chronological::first"]),
    );

    update({
      threads: [
        thread("first", { title: "Updated", latestAttentionAt: 2 }),
        thread("second"),
      ],
    });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::first",
    ]);

    update({ selectedThreadId: undefined });
    update({ selectedThreadId: "first" });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([]);
  });

  it("reveals only newly unread non-open threads and respects a later manual collapse", () => {
    const { store, update } = setup([
      thread("first"),
      thread("second"),
      thread("third"),
    ]);
    act(() =>
      store.set(sidebarCollapsedThreadSectionsAtom, [
        "chronological::first",
        "chronological::second",
        "chronological::third",
      ]),
    );
    update({
      threads: [
        thread("first", { latestAttentionAt: 2 }),
        thread("second", { latestAttentionAt: 2 }),
        thread("third"),
      ],
    });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::first",
      "chronological::third",
    ]);

    act(() =>
      store.set(sidebarCollapsedThreadSectionsAtom, ["chronological::second"]),
    );
    update({
      threads: [
        thread("first", { latestAttentionAt: 2 }),
        thread("second", { latestAttentionAt: 3 }),
        thread("third"),
      ],
    });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::second",
    ]);

    update({
      threads: [
        thread("first"),
        thread("second", { lastReadAt: 3, latestAttentionAt: 3 }),
        thread("third"),
      ],
    });
    update({
      threads: [
        thread("first"),
        thread("second", { lastReadAt: 3, latestAttentionAt: 4 }),
        thread("third"),
      ],
    });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([]);
  });

  it("keeps initially unread threads collapsed and ignores hidden unread threads", () => {
    const { store, update } = setup([
      thread("first"),
      thread("second", { latestAttentionAt: 2 }),
    ]);
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::second",
      "chronological::third",
    ]);
    update({
      threads: [
        thread("first"),
        thread("second", { latestAttentionAt: 2 }),
        thread("third", { latestAttentionAt: 2, isHidden: true }),
      ],
    });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::second",
      "chronological::third",
    ]);
  });

  it("waits for the threads to be ready before establishing the unread baseline", () => {
    const { store, update } = setup([thread("first")], {
      threadsReady: false,
    });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toContain(
      "chronological::first",
    );

    update({
      threadsReady: true,
      threads: [thread("first"), thread("second", { latestAttentionAt: 2 })],
    });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::second",
      "chronological::third",
    ]);

    update({ threads: [thread("first"), thread("second")] });
    update({
      threads: [thread("first"), thread("second", { latestAttentionAt: 2 })],
    });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::third",
    ]);
  });

  it("reveals the pinned ancestors and environment of a newly unread child", () => {
    const parent = thread("parent", {
      pinnedAt: 1,
      environment: makeSidebarEnvironment({ id: "env_parent" }),
    });
    const child = thread("child", {
      parentThreadId: "parent",
      environment: makeSidebarEnvironment({ id: "env_child" }),
    });
    const { store, update } = setup([thread("first"), parent, child]);
    act(() => {
      store.set(collapsedSidebarSectionIdsAtom, ["pinned"]);
      store.set(collapsedThreadIdsAtom, ["parent"]);
      store.set(collapsedEnvironmentIdsAtom, ["env_parent", "env_child"]);
    });
    update({
      threads: [
        thread("first"),
        parent,
        { ...child, latestAttentionAt: 2, isUnread: true },
      ],
    });
    expect(store.get(collapsedSidebarSectionIdsAtom)).toEqual([]);
    expect(store.get(collapsedThreadIdsAtom)).toEqual([]);
    expect(store.get(collapsedEnvironmentIdsAtom)).toEqual([]);
  });

  it("waits for preferences and the destination thread before revealing navigation", () => {
    const { store, update } = setup([], { preferencesReady: false });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toContain(
      "chronological::first",
    );
    update({ preferencesReady: true });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toContain(
      "chronological::first",
    );
    update({ threads: [thread("first")] });
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).not.toContain(
      "chronological::first",
    );
  });
});
