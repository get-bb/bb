// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";
import type { beginSplitDrag } from "@/lib/split-drag";
import { createSinglePaneLayout } from "@/views/thread-detail/splitThreadNavigation";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  begin: vi.fn<typeof beginSplitDrag>(),
}));
vi.mock("react-router-dom", async (original) => ({
  ...(await original<typeof import("react-router-dom")>()),
  useNavigate: () => mocks.navigate,
}));
vi.mock("@/lib/split-drag", async (original) => ({
  ...(await original<typeof import("@/lib/split-drag")>()),
  beginSplitDrag: mocks.begin,
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

describe("fresh draft split drag", () => {
  it("defers draft allocation until open is committed", () => {
    const store = createStore();
    store.set(
      splitLayoutAtom,
      createSinglePaneLayout({ projectId: "p1", threadId: "t1" }),
    );
    const create = vi.fn(
      () => ({ kind: "new-thread", draftId: "drf_fresh_open" }) as const,
    );
    const { result, rerender } = renderHook(
      () =>
        usePaneContentSplitDrag({
          content: create,
          enabled: true,
          label: "New thread",
        }),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider store={store}>{children}</Provider>
        ),
      },
    );
    rerender();
    expect(create).not.toHaveBeenCalled();
    result.current.openInSplit();
    expect(create).toHaveBeenCalledTimes(1);
    expect(mocks.navigate).toHaveBeenCalledWith(
      "/?draft=drf_fresh_open",
      undefined,
    );
  });
});
