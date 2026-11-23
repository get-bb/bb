import { splitLayoutAtom } from "./atoms";
import {
  countPanes,
  findPaneByContent,
  MAX_PANES,
  replacePaneContent,
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
    options?: { replace?: boolean },
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
  if (!enabled || layout === null) {
    void navigate(route);
    return;
  }
  const placed = placePaneContentInSplit(layout, content);
  if (placed.layout !== layout) store.set(splitLayoutAtom, placed.layout);
  void navigate(route, placed.alreadyOpen ? { replace: true } : undefined);
}

export function placePaneContentInSplit(
  layout: SplitLayout,
  content: PaneContent,
): { layout: SplitLayout; alreadyOpen: boolean } {
  const existing = findPaneByContent(layout.root, content);
  if (existing !== null) {
    return {
      layout:
        layout.focusedPaneId === existing.paneId
          ? layout
          : setFocus(layout, existing.paneId),
      alreadyOpen: true,
    };
  }
  return {
    layout:
      countPanes(layout.root) >= MAX_PANES
        ? replacePaneContent(layout, layout.focusedPaneId, content)
        : splitPane(layout, layout.focusedPaneId, "right", content),
    alreadyOpen: false,
  };
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
