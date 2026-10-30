import { useCallback, useMemo } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import { arrangeByStoredOrder, reorderStoredOrder } from "@/lib/stored-order";

export const rightPanelFixedTabOrderAtom = createSyncedPreferenceAtom(
  "rightPanel.fixedTabOrder",
);
export const rightPanelHiddenFixedTabsAtom = createSyncedPreferenceAtom(
  "rightPanel.hiddenFixedTabs",
);

interface ArrangeRightPanelFixedTabsArgs<TItem> {
  items: readonly TItem[];
  getId: (item: TItem) => string;
  order: readonly string[];
  hidden: readonly string[];
  activeId: string | null;
}

export function arrangeRightPanelFixedTabs<TItem>({
  items,
  getId,
  order,
  hidden,
  activeId,
}: ArrangeRightPanelFixedTabsArgs<TItem>) {
  const { ordered, normalizedOrder } = arrangeByStoredOrder({
    items,
    getId,
    storedOrder: order,
  });
  const hiddenIds = new Set(hidden);
  const shown = ordered.filter((item) => {
    const id = getId(item);
    return !hiddenIds.has(id) || id === activeId;
  });
  return { ordered, shown, normalizedOrder };
}

export function useSetRightPanelFixedTabShown() {
  const setHidden = useSetAtom(rightPanelHiddenFixedTabsAtom);
  return useCallback(
    (id: string, isShown: boolean) =>
      setHidden((previous) =>
        isShown
          ? previous.filter((hiddenId) => hiddenId !== id)
          : [...new Set([...previous, id])],
      ),
    [setHidden],
  );
}

export function useRightPanelFixedTabPreferences<TItem>({
  items,
  getId,
  activeId,
}: {
  items: readonly TItem[];
  getId: (item: TItem) => string;
  activeId: string | null;
}) {
  const [order, setOrder] = useAtom(rightPanelFixedTabOrderAtom);
  const hidden = useAtomValue(rightPanelHiddenFixedTabsAtom);
  const setShown = useSetRightPanelFixedTabShown();
  const { ordered, shown, normalizedOrder } = useMemo(
    () => arrangeRightPanelFixedTabs({ items, getId, order, hidden, activeId }),
    [items, getId, order, hidden, activeId],
  );
  return {
    ordered,
    shown,
    isHidden: (id: string) => hidden.includes(id),
    setShown,
    move(activeItemId: string, overItemId: string) {
      const next = reorderStoredOrder({
        activeId: activeItemId,
        overId: overItemId,
        order: normalizedOrder,
        visibleIds: ordered.map(getId),
      });
      if (next) setOrder(next);
    },
  };
}
