// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import {
  collapsedEnvironmentIdsAtom,
  collapsedSidebarSectionIdsAtom,
  collapsedThreadIdsAtom,
  sidebarCollapsedThreadSectionsAtom,
  sidebarOrganizationModeAtom,
} from "./sidebarCollapsedAtoms";
import { useSidebarThreadReveal } from "./useSidebarThreadReveal";

let navigation: SidebarBootstrapResponse | undefined;
let preferencesReady = true;
let isPlaceholderData = false;

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: navigation, isPlaceholderData }),
}));

vi.mock("@/lib/ui-preferences/UiPreferencesSync", () => ({
  useUiPreferencesReady: () => preferencesReady,
}));

beforeEach(() => {
  preferencesReady = true;
  isPlaceholderData = false;
});

afterEach(cleanup);

function thread(id: string, overrides: Partial<ThreadListEntry> = {}) {
  return makeThreadListEntry({
    id,
    projectId: "proj_personal",
    sectionId: id,
    lastReadAt: 1,
    latestAttentionAt: 1,
    ...overrides,
  });
}

function setThreads(threads: ThreadListEntry[]) {
  navigation = makeSidebarBootstrapResponse({
    personalProject: makeProjectWithThreadsResponse({
      id: "proj_personal",
      kind: "personal",
      threads,
    }),
  });
}

function setup(threads: ThreadListEntry[]) {
  setThreads(threads);
  const store = createStore();
  store.set(sidebarOrganizationModeAtom, "chronological");
  store.set(sidebarCollapsedThreadSectionsAtom, [
    "chronological::first",
    "chronological::second",
    "chronological::third",
  ]);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Provider store={store}>
        <MemoryRouter initialEntries={["/threads/first"]}>
          {children}
        </MemoryRouter>
      </Provider>
    );
  }
  const hook = renderHook(
    () => {
      useSidebarThreadReveal();
      return useNavigate();
    },
    { wrapper: Wrapper },
  );
  return { ...hook, store };
}

describe("useSidebarThreadReveal", () => {
  it("requires leaving and returning before revealing a manually collapsed open thread", () => {
    const { store, rerender, result } = setup([
      thread("first"),
      thread("second"),
    ]);
    act(() =>
      store.set(sidebarCollapsedThreadSectionsAtom, ["chronological::first"]),
    );

    setThreads([
      thread("first", { title: "Updated", latestAttentionAt: 2 }),
      thread("second"),
    ]);
    rerender();
    act(() => result.current("/threads/first?message=2"));
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::first",
    ]);

    act(() => result.current("/settings"));
    act(() => result.current(-1));
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([]);
  });

  it("reveals only newly unread non-open threads and respects a later manual collapse", () => {
    const { store, rerender } = setup([
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
    setThreads([
      thread("first", { latestAttentionAt: 2 }),
      thread("second", { latestAttentionAt: 2 }),
      thread("third"),
    ]);
    rerender();
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::first",
      "chronological::third",
    ]);

    act(() =>
      store.set(sidebarCollapsedThreadSectionsAtom, ["chronological::second"]),
    );
    setThreads([
      thread("first", { latestAttentionAt: 2 }),
      thread("second", { latestAttentionAt: 3 }),
      thread("third"),
    ]);
    rerender();
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::second",
    ]);

    setThreads([
      thread("first"),
      thread("second", { lastReadAt: 3, latestAttentionAt: 3 }),
      thread("third"),
    ]);
    rerender();
    setThreads([
      thread("first"),
      thread("second", { lastReadAt: 3, latestAttentionAt: 4 }),
      thread("third"),
    ]);
    rerender();
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([]);
  });

  it("keeps initially unread threads collapsed and ignores hidden unread threads", () => {
    const { store, rerender } = setup([
      thread("first"),
      thread("second", { latestAttentionAt: 2 }),
    ]);
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::second",
      "chronological::third",
    ]);
    setThreads([
      thread("first"),
      thread("second", { latestAttentionAt: 2 }),
      thread("third", { latestAttentionAt: 2, visibility: "hidden" }),
    ]);
    rerender();
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::second",
      "chronological::third",
    ]);
  });

  it("waits for the full bootstrap before establishing the unread baseline", () => {
    isPlaceholderData = true;
    const { store, rerender } = setup([thread("first")]);
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toContain(
      "chronological::first",
    );

    isPlaceholderData = false;
    setThreads([thread("first"), thread("second", { latestAttentionAt: 2 })]);
    rerender();
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::second",
      "chronological::third",
    ]);

    setThreads([thread("first"), thread("second")]);
    rerender();
    setThreads([thread("first"), thread("second", { latestAttentionAt: 2 })]);
    rerender();
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toEqual([
      "chronological::third",
    ]);
  });

  it("reveals the pinned ancestors and environment of a newly unread child", () => {
    const parent = thread("parent", {
      pinnedAt: 1,
      environmentId: "env_parent",
    });
    const child = thread("child", {
      parentThreadId: "parent",
      environmentId: "env_child",
    });
    const { store, rerender } = setup([thread("first"), parent, child]);
    act(() => {
      store.set(collapsedSidebarSectionIdsAtom, ["pinned"]);
      store.set(collapsedThreadIdsAtom, ["parent"]);
      store.set(collapsedEnvironmentIdsAtom, ["env_parent", "env_child"]);
    });
    setThreads([thread("first"), parent, { ...child, latestAttentionAt: 2 }]);
    rerender();
    expect(store.get(collapsedSidebarSectionIdsAtom)).toEqual([]);
    expect(store.get(collapsedThreadIdsAtom)).toEqual([]);
    expect(store.get(collapsedEnvironmentIdsAtom)).toEqual([]);
  });

  it("waits for preferences and the destination thread before revealing navigation", () => {
    preferencesReady = false;
    const { store, rerender } = setup([]);
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toContain(
      "chronological::first",
    );
    preferencesReady = true;
    rerender();
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).toContain(
      "chronological::first",
    );
    setThreads([thread("first")]);
    rerender();
    expect(store.get(sidebarCollapsedThreadSectionsAtom)).not.toContain(
      "chronological::first",
    );
  });
});
