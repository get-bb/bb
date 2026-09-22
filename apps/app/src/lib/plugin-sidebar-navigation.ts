import { useEffect, useMemo, useRef } from "react";
import type {
  ExperimentalSidebarNavigationActions,
  ExperimentalSidebarNavigationSplit,
  ExperimentalSidebarNavigationSplitOptions,
  ExperimentalSidebarNavigationState,
  PluginSidebarSplitPane,
} from "@get-bb/plugin-sdk";
import {
  useSidebarNavigationModel,
  useSidebarNavigationRowContent,
} from "@/components/sidebar/SidebarNavigationModel";
import { usePaneContentSplitIndicator } from "@/components/sidebar/paneContentSplitIndicator";
import { usePaneContentSplitDrag } from "@/components/sidebar/usePaneContentSplitDrag";

const NOOP_ACTIONS: ExperimentalSidebarNavigationActions = {
  activate() {},
  setVisible() {},
  setOrder() {},
  openCustomize() {},
  openDetails() {},
  disablePlugin: () => Promise.resolve(),
};

const EMPTY_STATE: ExperimentalSidebarNavigationState = {
  items: [],
  activeItemId: null,
  isShortcutModifierHeld: false,
  actions: NOOP_ACTIONS,
};

function guardActions(
  actions: ExperimentalSidebarNavigationActions,
  isMounted: () => boolean,
): ExperimentalSidebarNavigationActions {
  return {
    activate: (itemId, options) => {
      if (isMounted()) actions.activate(itemId, options);
    },
    setVisible: (itemId, isVisible) => {
      if (isMounted()) actions.setVisible(itemId, isVisible);
    },
    setOrder: (itemIds) => {
      if (isMounted()) actions.setOrder(itemIds);
    },
    openCustomize: () => {
      if (isMounted()) actions.openCustomize();
    },
    openDetails: (itemId) => {
      if (isMounted()) actions.openDetails(itemId);
    },
    disablePlugin: (itemId) =>
      isMounted() ? actions.disablePlugin(itemId) : Promise.resolve(),
  };
}

export function useSidebarNavigation(): ExperimentalSidebarNavigationState {
  const state = useSidebarNavigationModel()?.state ?? EMPTY_STATE;
  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const actions = useMemo(
    () => guardActions(state.actions, () => mountedRef.current),
    [state.actions],
  );
  return useMemo(
    () => ({
      items: state.items,
      activeItemId: state.activeItemId,
      isShortcutModifierHeld: state.isShortcutModifierHeld,
      actions,
    }),
    [actions, state.activeItemId, state.isShortcutModifierHeld, state.items],
  );
}

const PLACEHOLDER_CONTENT = { kind: "new-thread" } as const;

export function useSidebarNavigationSplit(
  itemId: string,
  splitOptions?: ExperimentalSidebarNavigationSplitOptions,
): ExperimentalSidebarNavigationSplit {
  const model = useSidebarNavigationModel();
  const target = useSidebarNavigationRowContent(itemId);
  const enabled = target !== null && (model?.splitEnabled ?? false);
  const onNavigate = model?.onNavigate;
  const activation = splitOptions?.activation ?? "sidebar";
  const onDragStartRef = useRef(splitOptions?.onDragStart);
  useEffect(() => {
    onDragStartRef.current = splitOptions?.onDragStart;
  });
  const options = useMemo(
    () => ({
      content: target?.content ?? PLACEHOLDER_CONTENT,
      enabled,
      label: target?.label ?? "",
      dragActivation: activation,
      onDragStart: () => onDragStartRef.current?.(),
      ...(onNavigate ? { onNavigate } : {}),
    }),
    [activation, enabled, onNavigate, target],
  );
  const { onPointerDown } = usePaneContentSplitDrag(options);
  const indicator = usePaneContentSplitIndicator(options.content, enabled);
  return useMemo<ExperimentalSidebarNavigationSplit>(() => {
    const panes: PluginSidebarSplitPane[] | null =
      indicator.miniMap === null
        ? null
        : indicator.miniMap.map((slot) => ({
            paneId: slot.paneId,
            rect: {
              x: slot.rect.x,
              y: slot.rect.y,
              width: slot.rect.w,
              height: slot.rect.h,
            },
            isMe: slot.isMe,
            isFocused: slot.isFocused,
          }));
    return {
      splitProps: onPointerDown ? { onPointerDown } : {},
      isAvailable: onPointerDown !== undefined,
      layout: panes === null ? null : { panes },
    };
  }, [indicator.miniMap, onPointerDown]);
}
