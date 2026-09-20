// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import {
  sidebarHiddenGroupsAtom,
  sidebarMachineSectionOrderAtom,
  sidebarManualSectionOrderAtom,
  sidebarSectionOrderAtom,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import { useSidebarModeSectionOrder } from "./useSidebarModeSectionOrder";

afterEach(cleanup);

describe("sidebar group visibility and ordering", () => {
  it.each([
    {
      mode: "project" as const,
      atom: sidebarSectionOrderAtom,
      hiddenId: "project:hidden" as const,
      visibleId: "project:visible" as const,
    },
    {
      mode: "chronological" as const,
      atom: sidebarManualSectionOrderAtom,
      hiddenId: "section:hidden" as const,
      visibleId: "section:visible" as const,
    },
    {
      mode: "machine" as const,
      atom: sidebarMachineSectionOrderAtom,
      hiddenId: "machine:no-machine" as const,
      visibleId: "machine:visible" as const,
    },
  ])(
    "hides $mode groups without changing their full order",
    ({ mode, atom, hiddenId, visibleId }) => {
      const store = createStore();
      const fullOrder = ["pinned", hiddenId, visibleId, "threads"];
      store.set(atom, fullOrder);
      store.set(sidebarHiddenGroupsAtom, [hiddenId]);
      const { result } = renderHook(
        () =>
          useSidebarModeSectionOrder({
            mode,
            entitySectionIds: [hiddenId, visibleId],
            showPinnedSection: true,
          }),
        {
          wrapper: ({ children }: { children: ReactNode }) => (
            <Provider store={store}>{children}</Provider>
          ),
        },
      );

      expect(result.current.order).toEqual(["pinned", visibleId, "threads"]);
      expect(result.current.persistedOrder).toEqual(fullOrder);
      act(() => store.set(sidebarHiddenGroupsAtom, []));
      expect(result.current.order).toEqual(fullOrder);
      expect(store.get(atom)).toEqual(fullOrder);
    },
  );

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

    act(() =>
      result.current.onFullOrderChange([
        "pinned",
        "section:b",
        "section:a",
        "threads",
      ]),
    );
    expect(result.current.order).toEqual(["section:a", "threads"]);
    expect(store.get(sidebarHiddenGroupsAtom)).toEqual(["section:b"]);
    act(() => store.set(sidebarHiddenGroupsAtom, []));
    expect(result.current.order).toEqual([
      "section:b",
      "section:a",
      "threads",
    ]);
  });
});
