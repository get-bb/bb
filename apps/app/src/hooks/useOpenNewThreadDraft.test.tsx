// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { listPanes } from "@/lib/split-layout/ops";
import { createSinglePaneLayout } from "@/views/thread-detail/splitThreadNavigation";
import { useOpenNewThreadDraft } from "./useOpenNewThreadDraft";

const mocks = vi.hoisted(() => ({ create: vi.fn(), navigate: vi.fn() }));
vi.mock("@/lib/drafts/resource-runtime", () => ({
  createNewThreadDraft: mocks.create,
  initializeNewThreadDraft: () => true,
}));
vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => mocks.navigate,
}));
vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe("fresh New thread navigation", () => {
  it("creates a distinct draft on each action in the focused pane and preserves each initial content", () => {
    mocks.create
      .mockReturnValueOnce("drf_first_action")
      .mockReturnValueOnce("drf_second_action");
    const store = createStore();
    store.set(
      splitLayoutAtom,
      createSinglePaneLayout({ projectId: "p1", threadId: "t1" }),
    );
    const { result } = renderHook(() => useOpenNewThreadDraft(), {
      wrapper: ({ children }: { children: ReactNode }) => (
        <Provider store={store}>{children}</Provider>
      ),
    });
    const first = { projectId: "p1", prompt: { text: "First draft" } };
    const second = { projectId: "p1", prompt: { text: "Second draft" } };
    act(() => {
      result.current(first, { state: { focusPrompt: true } });
      result.current(second, { state: { focusPrompt: true } });
    });
    expect(mocks.create.mock.calls).toEqual([[first], [second]]);
    expect(
      listPanes(store.get(splitLayoutAtom)!.root).map((pane) => pane.content),
    ).toEqual([{ kind: "new-thread", draftId: "drf_second_action" }]);
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      "/?draft=drf_second_action",
      { state: { focusPrompt: true } },
    );
  });
});
