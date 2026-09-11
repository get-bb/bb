import type { ThreadOpenSplit } from "@bb/server-contract";
import { getDraftRoutePath } from "@/lib/draft-route";
import { splitLayoutAtom } from "./atoms";
import {
  countPanes,
  findPaneByContent,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane,
} from "./ops";
import type { PaneContent, SplitLayout } from "./types";

interface OpenDraftInSplitArgs {
  store: {
    get(atom: typeof splitLayoutAtom): SplitLayout | null;
    set(atom: typeof splitLayoutAtom, value: SplitLayout): void;
  };
  navigate: (
    route: string,
    options?: { replace?: boolean },
  ) => void | Promise<void>;
  draftId: string;
  isCompact: boolean;
  split?: ThreadOpenSplit;
}

export function openDraftInSplit({
  store,
  navigate,
  draftId,
  isCompact,
  split = "right",
}: OpenDraftInSplitArgs): void {
  const route = getDraftRoutePath(draftId);
  const layout = store.get(splitLayoutAtom);
  const content: PaneContent = { kind: "new-thread", draftId };
  const existing =
    layout === null ? null : findPaneByContent(layout.root, content);
  if (layout !== null) {
    const next =
      existing !== null
        ? setFocus(layout, existing.paneId)
        : isCompact ||
            split === "replace" ||
            countPanes(layout.root) >= MAX_PANES
          ? replacePaneContent(layout, layout.focusedPaneId, content)
          : splitPane(
              layout,
              layout.focusedPaneId,
              split === "down" ? "bottom" : split,
              content,
            );
    if (next !== layout) store.set(splitLayoutAtom, next);
  }
  void navigate(route, existing !== null ? { replace: true } : undefined);
}
