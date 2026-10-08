import { useCallback, useMemo } from "react";
import { useAtom } from "jotai";
import {
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "@/components/plugin/pluginNavSidebarAtoms";
import {
  arrangePluginNavPanelPreferences,
  DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS,
  getPluginNavPanelKey,
  seedSkillsNavigationPreference,
  togglePluginNavPanelVisibility,
} from "@/components/plugin/pluginNavSidebarOrder";
import { haveSameOrder, reorderStoredOrder } from "@/lib/stored-order";

interface ArrangeableRow {
  pluginId: string;
  id: string;
}

export interface SidebarNavigationArrangement<Row extends ArrangeableRow> {
  ordered: Row[];
  visibleKeys: string[];
  setVisible(key: string, isVisible: boolean): void;
  moveAny(activeKey: string, overKey: string): void;
}

export function useSidebarNavigationArrangement<Row extends ArrangeableRow>(
  rows: readonly Row[],
  leadingOrderKeys: readonly string[],
): SidebarNavigationArrangement<Row> {
  const [storedOrder, setStoredOrder] = useAtom(pluginNavPanelOrderAtom);
  const [storedVisibleKeys, setStoredVisibleKeys] = useAtom(
    pluginNavVisiblePanelKeysAtom,
  );
  const seededPreferences = useMemo(
    () => seedSkillsNavigationPreference(storedOrder, storedVisibleKeys),
    [storedOrder, storedVisibleKeys],
  );
  const newLeadingKeys = useMemo(
    () =>
      leadingOrderKeys.filter((key) => !seededPreferences.order.includes(key)),
    [leadingOrderKeys, seededPreferences.order],
  );
  const newVisibleKeys = useMemo(
    () =>
      rows
        .map(getPluginNavPanelKey)
        .filter(
          (key) =>
            !seededPreferences.order.includes(key) &&
            !DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS.some(
              (hiddenKey) => hiddenKey === key,
            ),
        ),
    [rows, seededPreferences.order],
  );
  const { ordered, normalizedOrder, normalizedVisibleKeys, visibleKeys } =
    useMemo(
      () =>
        arrangePluginNavPanelPreferences({
          panels: rows,
          storedOrder:
            newLeadingKeys.length === 0
              ? seededPreferences.order
              : [...newLeadingKeys, ...seededPreferences.order],
          storedVisibleKeys:
            seededPreferences.visibleKeys === null ||
            newVisibleKeys.length === 0
              ? seededPreferences.visibleKeys
              : [...newVisibleKeys, ...seededPreferences.visibleKeys],
          defaultHiddenKeys: DEFAULT_HIDDEN_SIDEBAR_NAVIGATION_KEYS,
        }),
      [newLeadingKeys, newVisibleKeys, rows, seededPreferences],
    );
  const orderedKeys = useMemo(
    () => ordered.map(getPluginNavPanelKey),
    [ordered],
  );

  const persist = useCallback(
    (order: string[], nextVisibleKeys: string[] | null) => {
      if (!haveSameOrder(storedOrder, order)) setStoredOrder(order);
      if (
        storedVisibleKeys === nextVisibleKeys ||
        (storedVisibleKeys !== null &&
          nextVisibleKeys !== null &&
          haveSameOrder(storedVisibleKeys, nextVisibleKeys))
      ) {
        return;
      }
      setStoredVisibleKeys(nextVisibleKeys);
    },
    [setStoredOrder, setStoredVisibleKeys, storedOrder, storedVisibleKeys],
  );

  const setVisible = useCallback(
    (key: string, isVisible: boolean) => {
      if (!orderedKeys.includes(key)) return;
      persist(
        normalizedOrder,
        togglePluginNavPanelVisibility(
          normalizedVisibleKeys ?? visibleKeys,
          key,
          isVisible,
        ),
      );
    },
    [normalizedOrder, normalizedVisibleKeys, orderedKeys, persist, visibleKeys],
  );

  const moveAny = useCallback(
    (activeKey: string, overKey: string) => {
      const nextOrder = reorderStoredOrder({
        activeId: activeKey,
        overId: overKey,
        order: normalizedOrder,
        visibleIds: orderedKeys,
      });
      if (nextOrder) persist(nextOrder, normalizedVisibleKeys ?? visibleKeys);
    },
    [normalizedOrder, normalizedVisibleKeys, orderedKeys, persist, visibleKeys],
  );

  return {
    ordered,
    visibleKeys,
    setVisible,
    moveAny,
  };
}
