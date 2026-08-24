import {
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Sheet, useSheet } from "@/ui";
import { PanelContext, type PanelController } from "./PanelProvider";
import {
  MOBILE_SUPPORTED_TAB_KINDS,
  type PanelActiveView,
  type PanelScope,
} from "./panel-model";
import { PanelTabStrip } from "./PanelTabStrip";
import {
  UnregisteredLauncherContent,
  UnregisteredTabContent,
  UnsupportedTabContent,
} from "./PanelPlaceholders";
import {
  getPanelLauncherContent,
  getPanelTabContent,
  type PanelLauncherContentProps,
  type PanelTabContentProps,
} from "./registry";

const PANEL_SNAP_POINTS = ["92%"];

function viewKey(view: PanelActiveView): string {
  return view.kind === "tab"
    ? `tab:${view.tab.id}`
    : `launcher:${view.launcher}`;
}

interface ResolvedContent {
  key: string;
  retain: boolean;
  render: (active: boolean) => ReactNode;
}

function resolveContent(
  view: PanelActiveView,
  controller: PanelController,
  scope: PanelScope,
): ResolvedContent {
  const panelVisible = controller.visible;
  if (view.kind === "launcher") {
    const entry = getPanelLauncherContent(view.launcher);
    const Component = entry?.component ?? UnregisteredLauncherContent;
    return {
      key: viewKey(view),
      retain: entry?.options.retainWhenInactive ?? false,
      render: (active) => {
        const props: PanelLauncherContentProps = {
          scope,
          launcher: view.launcher,
          active,
          panelVisible,
          filesParams:
            view.launcher === "files" ? controller.view.filesParams : null,
        };
        return <Component {...props} />;
      },
    };
  }
  const entry = getPanelTabContent(view.tab.kind);
  const Component =
    entry?.component ??
    (MOBILE_SUPPORTED_TAB_KINDS.has(view.tab.kind)
      ? UnregisteredTabContent
      : UnsupportedTabContent);
  return {
    key: viewKey(view),
    retain: entry?.options.retainWhenInactive ?? false,
    render: (active) => {
      const props: PanelTabContentProps = {
        scope,
        tab: view.tab,
        active,
        panelVisible,
      };
      return <Component {...props} />;
    },
  };
}

/** The views that were active at least once and asked to stay mounted. */
function createRetainedViewsStore() {
  let snapshot: ReadonlyMap<string, PanelActiveView> = new Map();
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    retain(key: string, view: PanelActiveView) {
      if (snapshot.has(key)) return;
      const next = new Map(snapshot);
      next.set(key, view);
      snapshot = next;
      for (const listener of Array.from(listeners)) listener();
    },
  };
}

/**
 * Renders the active view and keeps previously active views whose content
 * opted into retention mounted (hidden) while they still exist, so a
 * terminal's socket or a diff list's scroll position survives a tab switch.
 */
function PanelContentHost({ controller }: { controller: PanelController }) {
  const { activeView, scope } = controller;
  const active = useMemo(
    () => resolveContent(activeView, controller, scope),
    [activeView, controller, scope],
  );
  const [retainedStore] = useState(createRetainedViewsStore);
  const retained = useSyncExternalStore(
    retainedStore.subscribe,
    retainedStore.getSnapshot,
    retainedStore.getSnapshot,
  );

  useEffect(() => {
    if (!active.retain) return;
    retainedStore.retain(active.key, activeView);
  }, [active.key, active.retain, activeView, retainedStore]);

  // Drop retained views whose tab was closed.
  const liveTabIds = useMemo(
    () => new Set(controller.view.tabs.secondary.tabs.map((tab) => tab.id)),
    [controller.view.tabs.secondary.tabs],
  );
  const retainedViews = useMemo(
    () =>
      Array.from(retained.values()).filter(
        (view) =>
          viewKey(view) !== active.key &&
          (view.kind === "launcher" || liveTabIds.has(view.tab.id)),
      ),
    [active.key, liveTabIds, retained],
  );

  // One keyed array for the active view and the retained ones: a view that
  // moves between "active" and "retained" keeps its key and its position
  // semantics in the same sibling list, so React keeps the component
  // instance (socket, WebView, scroll position, search text) mounted instead
  // of re-creating it. Rendering the active view in a separate slot would
  // remount it on every switch.
  const hosted = useMemo<{ content: ResolvedContent; isActive: boolean }[]>(
    () => [
      { content: active, isActive: true },
      ...retainedViews.map((view) => ({
        content: resolveContent(view, controller, scope),
        isActive: false,
      })),
    ],
    [active, controller, retainedViews, scope],
  );

  return (
    <View className="flex-1" testID="workspace-panel-content">
      {hosted.map(({ content, isActive }) => (
        <View
          key={content.key}
          style={isActive ? styles.fill : styles.retainedView}
          accessibilityElementsHidden={!isActive}
          importantForAccessibility={isActive ? "auto" : "no-hide-descendants"}
        >
          {content.render(isActive)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  retainedView: { display: "none" },
});

/**
 * The workspace panel: a tall bottom sheet (the web's compact 92dvh drawer)
 * with the tab strip and the active view. Presented / dismissed by the
 * controller's `visible`; a swipe-down reports back as `close()`.
 */
export function WorkspacePanelSheet({
  controller,
}: {
  controller: PanelController;
}) {
  const sheet = useSheet();
  const insets = useSafeAreaInsets();
  const { visible, close } = controller;
  // `dismiss()` on a never-presented modal leaves it in a dismissing state
  // that swallows the next `present()`, so only dismiss what was presented.
  const [presented, setPresented] = useState(false);

  useEffect(() => {
    if (visible && !presented) {
      sheet.present();
    } else if (!visible && presented) {
      sheet.dismiss();
    }
  }, [presented, sheet, visible]);

  return (
    <Sheet
      controller={sheet}
      layout="custom"
      snapPoints={PANEL_SNAP_POINTS}
      enableDynamicSizing={false}
      onOpenChange={setPresented}
      onDismiss={close}
      name="workspace-panel"
    >
      {/* The modal renders through the root portal host, outside the
          provider's subtree: re-provide the controller for the contents. */}
      <PanelContext.Provider value={controller}>
        {/* A plain flex-1 view, not BottomSheetView: the sheet's content
            container has an explicit height (the snap point minus the handle,
            plus an over-drag / keyboard padding at the bottom), so a flex-1
            child fills exactly the visible content box and the tab bodies
            (file previews, terminals, accessory bars) get a real height.
            BottomSheetView is absolutely positioned with top/left/right
            only (its height collapses to its content) and `bottom: 0` would
            run into the padding, pushing the last rows below the screen. */}
        <View
          style={[styles.fill, { paddingBottom: insets.bottom }]}
          testID="workspace-panel"
        >
          <PanelTabStrip
            entries={controller.entries}
            onActivate={controller.activate}
            onCloseTab={controller.closeTab}
            onCloseOtherTabs={controller.closeOtherTabs}
            onCloseAllTabs={controller.closeAllTabs}
          />
          <PanelContentHost controller={controller} />
        </View>
      </PanelContext.Provider>
    </Sheet>
  );
}
