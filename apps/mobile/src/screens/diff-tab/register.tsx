import { useBottomSheetScrollableCreator } from "@gorhom/bottom-sheet";
import { useCallback, useMemo } from "react";
import { resolveThreadComposerHost } from "@/data/files/thread-composer-host";
// Leaf imports (not the panel barrel): the barrel imports the registration
// manifest last, and this module is part of that manifest.
import { usePanel } from "../panel/PanelProvider";
import {
  registerPanelTabContent,
  type PanelTabContentProps,
  type PanelTabOfKind,
} from "../panel/registry";
import { DiffTabContent } from "./DiffTabContent";

/**
 * The workspace panel's `git-diff` tab: `DiffTabContent` over the panel
 * scope, with the panel's scroll-to intent (`view.diffPath`, consumed once
 * applied) and its visibility. "Add to chat" closes the panel, then quotes
 * into the thread's follow-up composer through the per-thread composer host
 * the thread screen registers (`registerThreadComposerHost`).
 */
function DiffPanelTabContent({
  scope,
  active,
  panelVisible,
}: PanelTabContentProps<PanelTabOfKind<"git-diff">>) {
  const panel = usePanel();
  const ScrollComponent = useBottomSheetScrollableCreator();
  const { close, consumeDiffPath } = panel;
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const quoteIntoComposer = useMemo(
    () =>
      threadId === null
        ? undefined
        : (text: string) => {
            close();
            resolveThreadComposerHost(threadId)?.quote(text);
          },
    [close, threadId],
  );
  const onFocusedPath = useCallback(() => consumeDiffPath(), [consumeDiffPath]);
  return (
    <DiffTabContent
      environmentId={scope.environmentId}
      focusPath={panel.view.diffPath}
      onFocusedPath={onFocusedPath}
      active={active && panelVisible}
      renderScrollComponent={ScrollComponent}
      quoteIntoComposer={quoteIntoComposer}
      testID="diff-tab"
    />
  );
}

registerPanelTabContent("git-diff", DiffPanelTabContent, {
  retainWhenInactive: true,
});
