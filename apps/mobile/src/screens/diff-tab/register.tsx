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
import {
  DiffTabHostProvider,
  useDiffTabHost,
  type DiffTabHost,
} from "./diff-tab-host";

/**
 * The workspace panel's `git-diff` tab: `DiffTabContent` over the panel
 * scope, with the panel's scroll-to intent (`view.diffPath`, consumed once
 * applied) and its visibility. "Add to chat" closes the panel, then quotes
 * into the thread's follow-up composer — through a `DiffTabHost` when one is
 * provided above the panel, else the per-thread composer host the thread
 * screen registers (`registerThreadComposerHost`).
 */
export function DiffPanelTabContent({
  scope,
  active,
  panelVisible,
}: PanelTabContentProps<PanelTabOfKind<"git-diff">>) {
  const panel = usePanel();
  const host = useDiffTabHost();
  const ScrollComponent = useBottomSheetScrollableCreator();
  const { close, consumeDiffPath } = panel;
  const threadId = scope.kind === "thread" ? scope.threadId : null;
  const hostQuote = host.quoteIntoComposer;
  const hostValue = useMemo<DiffTabHost>(() => {
    const quote =
      hostQuote ??
      (threadId === null
        ? null
        : (text: string) => resolveThreadComposerHost(threadId)?.quote(text));
    return {
      ...host,
      ...(quote
        ? {
            quoteIntoComposer: (text: string) => {
              close();
              quote(text);
            },
          }
        : {}),
    };
  }, [close, host, hostQuote, threadId]);
  const onFocusedPath = useCallback(() => consumeDiffPath(), [consumeDiffPath]);
  return (
    <DiffTabHostProvider value={hostValue}>
      <DiffTabContent
        threadId={scope.kind === "thread" ? scope.threadId : null}
        environmentId={scope.environmentId}
        focusPath={panel.view.diffPath}
        onFocusedPath={onFocusedPath}
        active={active && panelVisible}
        renderScrollComponent={ScrollComponent}
        testID="diff-tab"
      />
    </DiffTabHostProvider>
  );
}

registerPanelTabContent("git-diff", DiffPanelTabContent, {
  retainWhenInactive: true,
});
