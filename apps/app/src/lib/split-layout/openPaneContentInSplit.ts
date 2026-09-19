import { requestSplitLayoutChange } from "./newThreadPaneGuard";
import { splitLayoutAtom } from "./atoms";
import {
  countPanes,
  createComposerPaneId,
  findPaneByContent,
  MAX_PANES,
  replacePaneContent,
  replaceWithNewThreadComposer,
  setFocus,
  splitPane,
  type PaneContent,
  type SplitLayout,
} from "./index";

interface SplitLayoutStore {
  get(atom: typeof splitLayoutAtom): SplitLayout | null;
  set(atom: typeof splitLayoutAtom, value: SplitLayout): void;
}

export interface OpenPaneContentInSplitArgs {
  store: SplitLayoutStore;
  navigate: (
    route: string,
    options?: { replace?: boolean; state?: Record<string, unknown> },
  ) => void | Promise<void>;
  content: PaneContent;
  route: string;
  enabled: boolean;
}

export function openPaneContentInSplit({
  store,
  navigate,
  content,
  route,
  enabled,
}: OpenPaneContentInSplitArgs): void {
  const layout = store.get(splitLayoutAtom);
  if (!enabled) {
    void navigate(route);
    return;
  }
  if (layout === null) {
    if (content.kind === "new-thread") {
      const paneId = createComposerPaneId();
      store.set(splitLayoutAtom, {
        root: { type: "pane", paneId, content },
        focusedPaneId: paneId,
      });
      void navigate(route, { state: { composerPaneId: paneId } });
    } else {
      void navigate(route);
    }
    return;
  }
  const existing =
    content.kind === "new-thread"
      ? null
      : findPaneByContent(layout.root, content);
  const next =
    existing !== null
      ? setFocus(layout, existing.paneId)
      : countPanes(layout.root) >= MAX_PANES
        ? content.kind === "new-thread"
          ? replaceWithNewThreadComposer(layout, layout.focusedPaneId)
          : replacePaneContent(layout, layout.focusedPaneId, content)
        : splitPane(layout, layout.focusedPaneId, "right", content);
  requestSplitLayoutChange(store, next, () => {
    void navigate(
      route,
      content.kind === "new-thread"
        ? { state: { composerPaneId: next.focusedPaneId } }
        : existing !== null
          ? { replace: true }
          : undefined,
    );
  });
}

export function holdsPluginDetailPane(
  layout: SplitLayout | null,
  pluginId: string,
): boolean {
  if (layout === null) return false;
  return (
    findPaneByContent(layout.root, { kind: "plugin-detail", pluginId }) !== null
  );
}
