// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import type { SidebarSectionId } from "@bb/client-core";
import {
  sidebarHiddenGroupsAtom,
  sidebarManualSectionOrderAtom,
  sidebarSectionOrderAtom,
} from "../preferences/atoms.js";
import { useSidebarModeSectionOrder } from "./useSidebarModeSectionOrder.js";

afterEach(cleanup);

describe("sidebar group visibility and ordering", () => {
  it("retains hidden, pinned, and disconnected slots when visible groups move", () => {
    const store = createStore();
    store.set(sidebarSectionOrderAtom, [
      "pinned",
      "project:a",
      "project:b",
      "project:offline",
      "project:c",
      "threads",
    ]);
    store.set(sidebarHiddenGroupsAtom, ["project:b"]);
    const { result, rerender } = renderHook(
      ({ entitySectionIds }: { entitySectionIds: SidebarSectionId[] }) =>
        useSidebarModeSectionOrder({
          mode: "project",
          entitySectionIds,
          showPinnedSection: false,
        }),
      {
        initialProps: {
          entitySectionIds: ["project:a", "project:b", "project:c"],
        },
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider store={store}>{children}</Provider>
        ),
      },
    );

    expect(result.current.order).toEqual(["project:a", "project:c", "threads"]);

    act(() =>
      result.current.onOrderChange(["project:c", "project:a", "threads"]),
    );
    expect(store.get(sidebarSectionOrderAtom)).toEqual([
      "pinned",
      "project:c",
      "project:b",
      "project:offline",
      "project:a",
      "threads",
    ]);
    act(() => store.set(sidebarHiddenGroupsAtom, []));
    rerender({
      entitySectionIds: [
        "project:a",
        "project:b",
        "project:c",
        "project:offline",
      ],
    });
    expect(result.current.order).toEqual([
      "project:c",
      "project:b",
      "project:offline",
      "project:a",
      "threads",
    ]);
  });

  it("lets customization move hidden groups without making them visible", () => {
    const store = createStore();
    store.set(sidebarManualSectionOrderAtom, [
      "pinned",
      "section:a",
      "section:b",
      "threads",
    ]);
    store.set(sidebarHiddenGroupsAtom, ["section:b"]);
    const { result } = renderHook(
      () =>
        useSidebarModeSectionOrder({
          mode: "chronological",
          entitySectionIds: ["section:a", "section:b"],
          showPinnedSection: false,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider store={store}>{children}</Provider>
        ),
      },
    );

    act(() => result.current.onOrderChange(["section:b", "section:a"]));
    expect(store.get(sidebarManualSectionOrderAtom)).toEqual([
      "pinned",
      "section:b",
      "section:a",
      "threads",
    ]);
    expect(result.current.order).toEqual(["section:a", "threads"]);
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual(["section:b"]);
    act(() => store.set(sidebarHiddenGroupsAtom, []));
    expect(result.current.order).toEqual(["section:b", "section:a", "threads"]);
  });

  it("moves the built-in Threads section out of every organization when hidden", () => {
    const store = createStore();
    store.set(sidebarHiddenGroupsAtom, ["threads"]);
    const { result } = renderHook(
      () =>
        useSidebarModeSectionOrder({
          mode: "chronological",
          entitySectionIds: ["section:a"],
          showPinnedSection: true,
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider store={store}>{children}</Provider>
        ),
      },
    );

    expect(result.current.persistedOrder).toEqual([
      "pinned",
      "section:a",
      "threads",
    ]);
    expect(result.current.order).toEqual(["pinned", "section:a"]);
  });
});
