import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import {
  hasSingleUseRootComposeTargetState,
  readRootComposeEnvironmentTargetFromLocationState,
  shouldStartComposingFromLocationState,
} from "@/views/RootComposeView";
import { readThreadCreationPlacement } from "@/lib/thread-creation-placement";
import { splitLayoutAtom } from "./atoms";
import { openNewThread } from "./openNewThread";
import {
  countPanes,
  findPaneByContent,
  MAX_PANES,
  type SplitLayout,
} from "./index";

function threadPane(index: number) {
  return {
    type: "pane" as const,
    paneId: `pane-${index}`,
    content: {
      kind: "thread" as const,
      projectId: "project-1",
      threadId: `thread-${index}`,
    },
  };
}

function rowOf(panes: SplitLayout["root"][]): SplitLayout {
  return {
    root: {
      type: "split",
      dir: "row",
      sizes: panes.map(() => 1 / panes.length),
      children: panes,
    },
    focusedPaneId: "pane-1",
  };
}

function open(
  layout: SplitLayout | null,
  options: Partial<Parameters<typeof openNewThread>[0]> = {},
) {
  const store = createStore();
  store.set(splitLayoutAtom, layout);
  const navigate = vi.fn();
  openNewThread({ navigate, store, isCompact: false, split: true, ...options });
  return { navigate, layout: store.get(splitLayoutAtom) };
}

describe("openNewThread", () => {
  it("focuses the open New thread pane and replaces history instead of opening a second one", () => {
    const start = rowOf([
      threadPane(1),
      { type: "pane", paneId: "pane-2", content: { kind: "new-thread" } },
    ]);
    const { navigate, layout } = open(start, { focusPrompt: true });
    expect(layout?.root).toBe(start.root);
    expect(layout?.focusedPaneId).toBe("pane-2");
    expect(navigate).toHaveBeenCalledWith("/", {
      replace: true,
      state: { focusPrompt: true },
    });
  });

  it("replaces the focused pane at the pane cap", () => {
    const start = rowOf(
      Array.from({ length: MAX_PANES }, (_, index) => threadPane(index + 1)),
    );
    const { layout } = open(start);
    expect(countPanes(layout!.root)).toBe(MAX_PANES);
    expect(
      findPaneByContent(layout!.root, { kind: "new-thread" })?.paneId,
    ).toBe("pane-1");
  });

  it("navigates without touching the panes on a compact viewport or without split", () => {
    const start = rowOf([threadPane(1), threadPane(2)]);
    for (const options of [{ isCompact: true }, { split: false }]) {
      const { navigate, layout } = open(start, options);
      expect(layout).toBe(start);
      expect(navigate).toHaveBeenCalledWith("/", {});
    }
  });

  it("hands the New thread screen an environment, placement and focus it acts on once", () => {
    const { navigate } = open(null, {
      environmentId: "env_1",
      placement: { sectionId: "sec_a", pinned: true },
      focusPrompt: true,
      hostId: "  ",
    });
    const state: unknown = navigate.mock.calls[0]?.[1]?.state;
    expect(readRootComposeEnvironmentTargetFromLocationState(state)).toEqual({
      kind: "reuse",
      environmentId: "env_1",
    });
    expect(readThreadCreationPlacement(state)).toEqual({
      sectionId: "sec_a",
      pinned: true,
    });
    expect(shouldStartComposingFromLocationState(state)).toBe(true);
    expect(hasSingleUseRootComposeTargetState(state)).toBe(true);
  });
});
