// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import {
  findPane,
  listPanes,
  splitPane,
  type PaneContent,
} from "@/lib/split-layout";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";
import type { beginSplitDrag } from "@/lib/split-drag";
import { createSinglePaneLayout } from "@/views/thread-detail/splitThreadNavigation";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  begin: vi.fn<typeof beginSplitDrag>(),
  isCompact: vi.fn(() => false),
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
  useIsCompactViewport: mocks.isCompact,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.isCompact.mockReturnValue(false);
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function DraftAction({
  content,
}: {
  content: PaneContent | (() => PaneContent);
}) {
  const actions = usePaneContentSplitDrag({
    content,
    enabled: true,
    label: "New thread",
  });
  return (
    <button onPointerDown={actions.onPointerDown} onClick={actions.openInSplit}>
      Open draft
    </button>
  );
}

function startDrag() {
  fireEvent(
    screen.getByRole("button", { name: "Open draft" }),
    new MouseEvent("pointerdown", {
      bubbles: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    }),
  );
  const config = mocks.begin.mock.calls[0]?.[0];
  if (config === undefined) throw new Error("Expected a split drag session");
  return config;
}

describe("fresh draft split drag", () => {
  it.each([
    { mode: "split", compact: false, enabled: true },
    { mode: "compact fallback", compact: true, enabled: true },
    { mode: "disabled split fallback", compact: false, enabled: false },
  ])(
    "defers allocation and opens an editable draft through $mode",
    ({ compact, enabled }) => {
      mocks.isCompact.mockReturnValue(compact);
      const store = createStore();
      const initialLayout = createSinglePaneLayout({
        projectId: "p1",
        threadId: "t1",
      });
      store.set(splitLayoutAtom, initialLayout);
      const create = vi.fn(
        () => ({ kind: "new-thread", draftId: "drf_fresh_open" }) as const,
      );
      const { result, rerender } = renderHook(
        () =>
          usePaneContentSplitDrag({
            content: create,
            enabled,
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
      act(() => result.current.openInSplit());
      expect(create).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).toHaveBeenCalledWith("/?draft=drf_fresh_open", {
        state: { focusPrompt: true },
      });
      const layout = store.get(splitLayoutAtom)!;
      if (compact || !enabled) {
        expect(layout).toEqual(initialLayout);
      } else {
        expect(listPanes(layout.root)).toHaveLength(2);
        expect(findPane(layout.root, "pane-1")).toEqual(initialLayout.root);
        expect(findPane(layout.root, layout.focusedPaneId)?.content).toEqual({
          kind: "new-thread",
          draftId: "drf_fresh_open",
        });
      }
    },
  );

  it.each(["right", "center"] as const)(
    "starts editing only when a fresh draft drop commits to %s",
    (zone) => {
      const store = createStore();
      const initialLayout = createSinglePaneLayout({
        projectId: "p1",
        threadId: "t1",
      });
      store.set(splitLayoutAtom, initialLayout);
      const create = vi.fn(
        () => ({ kind: "new-thread", draftId: "drf_fresh_drop" }) as const,
      );
      render(
        <Provider store={store}>
          <DraftAction content={create} />
        </Provider>,
      );

      const drag = startDrag();
      expect(drag.decide("pane-1", zone)).not.toBeNull();
      expect(create).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
      act(() => drag.onDrop({ paneId: "pane-1", zone }));

      expect(create).toHaveBeenCalledTimes(1);
      expect(mocks.navigate).toHaveBeenCalledWith("/?draft=drf_fresh_drop", {
        state: { focusPrompt: true },
      });
      const layout = store.get(splitLayoutAtom)!;
      expect(listPanes(layout.root)).toHaveLength(zone === "right" ? 2 : 1);
      expect(findPane(layout.root, layout.focusedPaneId)?.content).toEqual({
        kind: "new-thread",
        draftId: "drf_fresh_drop",
      });
      if (zone === "right")
        expect(findPane(layout.root, "pane-1")).toEqual(initialLayout.root);
    },
  );

  it.each(["open", "drop"] as const)(
    "focuses an existing draft on %s without restarting composition",
    (activation) => {
      const store = createStore();
      const content: PaneContent = {
        kind: "new-thread",
        draftId: "drf_saved_draft",
      };
      const layout = splitPane(
        createSinglePaneLayout({ projectId: "p1", threadId: "t1" }),
        "pane-1",
        "right",
        content,
      );
      const draftPaneId = layout.focusedPaneId;
      store.set(splitLayoutAtom, { ...layout, focusedPaneId: "pane-1" });
      render(
        <Provider store={store}>
          <DraftAction content={content} />
        </Provider>,
      );

      if (activation === "open") {
        fireEvent.click(screen.getByRole("button", { name: "Open draft" }));
      } else {
        const drag = startDrag();
        act(() => drag.onDrop({ paneId: "pane-1", zone: "center" }));
      }

      expect(store.get(splitLayoutAtom)).toEqual({
        ...layout,
        focusedPaneId: draftPaneId,
      });
      expect(mocks.navigate).toHaveBeenCalledWith("/?draft=drf_saved_draft", {
        replace: true,
      });
    },
  );
});
