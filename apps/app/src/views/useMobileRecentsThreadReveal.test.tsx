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
import { mobileRecentsCollapsedThreadIdsAtom } from "./mobile-recents-collapse";
import { useMobileRecentsThreadReveal } from "./useMobileRecentsThreadReveal";

let navigation: SidebarBootstrapResponse | undefined;
let isPlaceholderData = false;

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: navigation, isPlaceholderData }),
}));

beforeEach(() => {
  isPlaceholderData = false;
  localStorage.clear();
});

afterEach(cleanup);

function thread(id: string, overrides: Partial<ThreadListEntry> = {}) {
  return makeThreadListEntry({
    id,
    projectId: "proj_personal",
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

function setup(threads: ThreadListEntry[], collapsed: string[]) {
  setThreads(threads);
  const store = createStore();
  store.set(mobileRecentsCollapsedThreadIdsAtom, collapsed);
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <Provider store={store}>
        <MemoryRouter initialEntries={["/threads/other"]}>
          {children}
        </MemoryRouter>
      </Provider>
    );
  }
  const hook = renderHook(
    () => {
      useMobileRecentsThreadReveal();
      return useNavigate();
    },
    { wrapper: Wrapper },
  );
  return { ...hook, store };
}

const root = thread("root");
const parent = thread("parent", { parentThreadId: "root" });
const child = thread("child", { parentThreadId: "parent" });

describe("useMobileRecentsThreadReveal", () => {
  it("opens every collapsed ancestor of the thread you navigate to, once per visit", () => {
    const { store, rerender, result } = setup(
      [thread("other"), root, parent, child],
      ["root", "parent", "unrelated"],
    );

    act(() => result.current("/threads/child"));
    rerender();
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual([
      "unrelated",
    ]);

    act(() => store.set(mobileRecentsCollapsedThreadIdsAtom, ["parent"]));
    rerender();
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual(["parent"]);

    act(() => result.current("/threads/other"));
    rerender();
    act(() => result.current("/threads/child"));
    rerender();
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual([]);
  });

  it("opens ancestors of newly unread threads but not of threads unread at load or hidden", () => {
    const hiddenChild = thread("hidden", {
      parentThreadId: "root",
      visibility: "hidden",
    });
    const { store, rerender } = setup(
      [
        thread("other"),
        root,
        parent,
        { ...child, status: "idle", latestAttentionAt: 2 },
        hiddenChild,
      ],
      ["root", "parent"],
    );
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual([
      "root",
      "parent",
    ]);

    setThreads([
      thread("other"),
      root,
      parent,
      { ...child, status: "idle", latestAttentionAt: 2 },
      { ...hiddenChild, status: "idle", latestAttentionAt: 2 },
    ]);
    rerender();
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual([
      "root",
      "parent",
    ]);

    const sibling = thread("sibling", { parentThreadId: "parent" });
    setThreads([
      thread("other"),
      root,
      parent,
      { ...child, status: "idle", latestAttentionAt: 2 },
      { ...sibling, status: "idle", latestAttentionAt: 2 },
    ]);
    rerender();
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual([]);
  });

  it("waits for the full bootstrap before taking the unread baseline or revealing navigation", () => {
    isPlaceholderData = true;
    const { store, rerender, result } = setup(
      [thread("other"), root, parent],
      ["root", "parent"],
    );
    act(() => result.current("/threads/child"));
    rerender();
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual([
      "root",
      "parent",
    ]);

    isPlaceholderData = false;
    rerender();
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual([
      "root",
      "parent",
    ]);

    setThreads([thread("other"), root, parent, child]);
    rerender();
    expect(store.get(mobileRecentsCollapsedThreadIdsAtom)).toEqual([]);
  });
});
