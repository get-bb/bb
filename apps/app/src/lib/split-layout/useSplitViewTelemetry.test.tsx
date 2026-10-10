// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { splitLayoutAtom } from "./atoms";
import { removePane, splitPane } from "./ops";
import type { SplitLayout } from "./types";
import { useSplitViewTelemetry } from "./useSplitViewTelemetry";

const mocks = vi.hoisted(() => ({ recordTelemetryEvent: vi.fn() }));

vi.mock("@/components/onboarding/onboarding-telemetry", () => ({
  recordTelemetryEvent: mocks.recordTelemetryEvent,
}));

afterEach(() => {
  cleanup();
  mocks.recordTelemetryEvent.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

const thread = (threadId: string) => ({ kind: "thread" as const, projectId: "project-1", threadId });

function singlePane(): SplitLayout {
  return { root: { type: "pane", paneId: "pane-1", content: thread("thread-1") }, focusedPaneId: "pane-1" };
}

function mount(initial: SplitLayout | null) {
  const store = createStore();
  store.set(splitLayoutAtom, initial);
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>;
  renderHook(() => useSplitViewTelemetry(), { wrapper });
  const update = (next: (layout: SplitLayout) => SplitLayout) => act(() => {
    store.set(splitLayoutAtom, next(store.get(splitLayoutAtom) ?? singlePane()));
  });
  return { update };
}

describe("useSplitViewTelemetry", () => {
  it("reports each added pane with the pane count, and nothing for closing panes", () => {
    const { update } = mount(singlePane());
    update((layout) => splitPane(layout, "pane-1", "right", thread("thread-2")));
    update((layout) => splitPane(layout, layout.focusedPaneId, "bottom", thread("thread-3")));
    update((layout) => removePane(layout, layout.focusedPaneId));
    expect(mocks.recordTelemetryEvent.mock.calls).toEqual([
      [{ name: "split_view_opened", properties: { panes: 2 } }],
      [{ name: "split_view_opened", properties: { panes: 3 } }],
    ]);
  });

  it("does not report a split layout restored when the app opens", () => {
    const restored = splitPane(singlePane(), "pane-1", "right", thread("thread-2"));
    mount(restored);
    expect(mocks.recordTelemetryEvent).not.toHaveBeenCalled();
  });
});
