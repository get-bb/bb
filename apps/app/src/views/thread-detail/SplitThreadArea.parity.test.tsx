// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import type { LayoutNode, PaneContent, SplitLayout } from "@/lib/split-layout";
import { SplitThreadArea } from "./SplitThreadArea";

// The heavy thread view is stubbed to a marker so the test observes only the
// wrapper DOM SplitThreadArea itself introduces.
vi.mock("./ThreadDetailView", () => ({
  ThreadDetailView: (props: { threadId?: string }) => (
    <div data-testid="thread-view" data-thread={props.threadId ?? "page"} />
  ),
}));

// Phase 4's keyboard command registration isn't relevant to DOM parity.
vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandContext: () => undefined,
  useAppCommandHandler: () => undefined,
  useIndexedAppCommandHandlers: () => undefined,
}));

vi.mock("@/hooks/useRouteState", () => ({
  useRouteState: () => ({ projectId: "p1", threadId: "t1" }),
}));

vi.mock("@bb/shared-ui/hooks/use-compact-viewport", () => ({
  useIsCompactViewport: () => false,
}));

function content(threadId: string): PaneContent {
  return { kind: "thread", projectId: "p1", threadId };
}

function pane(paneId: string, threadId: string): LayoutNode {
  return { type: "pane", paneId, content: content(threadId) };
}

function renderArea(layout: SplitLayout) {
  const store = createStore();
  store.set(splitLayoutAtom, layout);
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={["/projects/p1/threads/t1"]}>
        <SplitThreadArea />
      </MemoryRouter>
    </Provider>,
  );
}

describe("SplitThreadArea single-pane parity", () => {
  it("renders the single pane with no wrapper element around the thread view", () => {
    const { container, getAllByTestId } = renderArea({
      root: pane("pane-1", "t1"),
      focusedPaneId: "pane-1",
    });
    // The wrapper-less single-pane surface adds no pane-id hit-test element and
    // no layout wrapper: the thread view is the direct rendered child, matching
    // the pre-split page surface.
    expect(container.querySelectorAll("[data-split-pane-id]")).toHaveLength(0);
    expect(getAllByTestId("thread-view")).toHaveLength(1);
    expect(container.firstElementChild?.getAttribute("data-testid")).toBe(
      "thread-view",
    );
  });

  it("wraps each pane once the layout actually splits", () => {
    const { container } = renderArea({
      root: {
        type: "split",
        dir: "row",
        sizes: [0.5, 0.5],
        children: [pane("pane-1", "t1"), pane("pane-2", "t2")],
      },
      focusedPaneId: "pane-1",
    });
    // Only the multi-pane path carries pane-id hit-test wrappers.
    expect(container.querySelectorAll("[data-split-pane-id]")).toHaveLength(2);
  });
});