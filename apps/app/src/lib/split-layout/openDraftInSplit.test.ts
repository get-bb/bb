import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { splitLayoutAtom } from "./atoms";
import { openDraftInSplit } from "./openDraftInSplit";
import {
  findPaneByContent,
  listPanes,
  replaceDraftPaneContent,
  setFocus,
  splitPane,
} from "./ops";
import { createSinglePaneLayout } from "@/views/thread-detail/splitThreadNavigation";
import type { ThreadOpenSplit } from "@bb/server-contract";

const first = { kind: "new-thread", draftId: "drf_first_draft" } as const;
const second = { kind: "new-thread", draftId: "drf_second_draft" } as const;
const thread = { kind: "thread", projectId: "p1", threadId: "t1" } as const;

function setup() {
  const store = createStore();
  const layout = splitPane(
    createSinglePaneLayout(thread),
    "pane-1",
    "right",
    first,
  );
  store.set(splitLayoutAtom, layout);
  return {
    store,
    navigate: vi.fn(),
    isCompact: false,
    draftId: second.draftId,
  };
}

describe("draft split navigation", () => {
  it("opens independent drafts beside the current draft and focuses the saved pane on repeat", () => {
    const args = setup();
    openDraftInSplit(args);
    const opened = args.store.get(splitLayoutAtom)!;
    expect(listPanes(opened.root).map((pane) => pane.content)).toEqual([
      thread,
      first,
      second,
    ]);
    openDraftInSplit({ ...args, draftId: first.draftId });
    const focused = args.store.get(splitLayoutAtom)!;
    expect(listPanes(focused.root)).toHaveLength(3);
    expect(focused.focusedPaneId).toBe(
      findPaneByContent(focused.root, first)!.paneId,
    );
    expect(args.navigate).toHaveBeenLastCalledWith("/?draft=drf_first_draft", {
      replace: true,
    });
  });

  it.each<ThreadOpenSplit>(["right", "down", "left", "top", "replace"])(
    "honors public %s placement",
    (split) => {
      const args = setup();
      openDraftInSplit({ ...args, split });
      const panes = listPanes(args.store.get(splitLayoutAtom)!.root);
      expect(panes).toHaveLength(split === "replace" ? 2 : 3);
      const firstIndex = panes.findIndex(
        (pane) =>
          pane.content.kind === "new-thread" &&
          pane.content.draftId === first.draftId,
      );
      const secondIndex = panes.findIndex(
        (pane) =>
          pane.content.kind === "new-thread" &&
          pane.content.draftId === second.draftId,
      );
      if (split !== "replace")
        expect(secondIndex < firstIndex).toBe(
          split === "left" || split === "top",
        );
    },
  );

  it("replaces the focused pane at the pane limit and in compact mode", () => {
    for (const isCompact of [false, true]) {
      const args = setup();
      for (let i = 2; i < 8; i += 1) {
        const layout = args.store.get(splitLayoutAtom)!;
        args.store.set(
          splitLayoutAtom,
          splitPane(layout, layout.focusedPaneId, "right", {
            kind: "new-thread",
            draftId: `drf_filler_${i}`,
          }),
        );
      }
      openDraftInSplit({ ...args, isCompact });
      expect(listPanes(args.store.get(splitLayoutAtom)!.root)).toHaveLength(8);
    }
  });

  it("updates a submitted draft's origin without moving focus or replacing a reused pane", () => {
    const args = setup();
    const origin = args.store.get(splitLayoutAtom)!;
    const unfocused = setFocus(origin, "pane-1");
    const replaced = replaceDraftPaneContent(
      unfocused,
      "pane-2",
      first.draftId,
      second,
    )!;
    expect(replaced.focusedPaneId).toBe("pane-1");
    expect(findPaneByContent(replaced.root, second)?.paneId).toBe("pane-2");
    expect(
      replaceDraftPaneContent(replaced, "pane-2", first.draftId, thread),
    ).toBe(replaced);
    expect(
      replaceDraftPaneContent(unfocused, "missing", first.draftId, thread),
    ).toBe(unfocused);
  });
});
