import { atom, useAtom, useAtomValue } from "jotai";
import {
  usePluginSlots,
  type PluginSidebarFooterItemSlot,
} from "@/lib/plugin-slots";
import { createSyncedPreferenceAtom } from "@/lib/ui-preferences/synced-preference-atom";
import { arrangeByStoredOrder, reorderStoredOrder } from "@/lib/stored-order";

export const sidebarFooterOrderAtom = createSyncedPreferenceAtom(
  "sidebar.footerOrder",
);
export const sidebarFooterHiddenAtom = createSyncedPreferenceAtom(
  "sidebar.hiddenFooterItems",
);
export const SIDEBAR_FOOTER_MORE_ID = "sidebar-footer-more";
export const sidebarFooterCapacityAtom = atom<number | null>(null);

export type BuiltinFooterId = "settings" | "report-bug";
export type FooterItem = { key: string; label: string; icon: string } & (
  | { kind: "builtin"; id: BuiltinFooterId }
  | { kind: "plugin"; slot: PluginSidebarFooterItemSlot }
);
export function footerPreferenceKey(item: {
  pluginId: string;
  id: string;
}): string {
  return `plugin:${encodeURIComponent(item.pluginId)}/${encodeURIComponent(item.id)}`;
}

export function useSidebarFooterPreferences() {
  const { sidebarFooterItems } = usePluginSlots();
  const [order, setOrder] = useAtom(sidebarFooterOrderAtom);
  const [hidden, setHidden] = useAtom(sidebarFooterHiddenAtom);
  const capacity = useAtomValue(sidebarFooterCapacityAtom);
  const items: FooterItem[] = [
    {
      kind: "builtin",
      id: "settings",
      key: "builtin:settings",
      label: "Settings",
      icon: "Settings",
    },
    ...sidebarFooterItems.map((slot): FooterItem => ({
      kind: "plugin",
      key: footerPreferenceKey(slot),
      label: slot.label,
      icon: slot.icon,
      slot,
    })),
    {
      kind: "builtin",
      id: "report-bug",
      key: "builtin:report-bug",
      label: "Report a bug",
      icon: "Bug",
    },
  ];
  const { ordered, normalizedOrder } = arrangeByStoredOrder({
    items,
    storedOrder: order,
    getId: (item) => item.key,
  });
  const footer = ordered
    .filter((item) => !hidden.includes(item.key))
    .slice(0, capacity ?? undefined);
  const more = ordered.filter((item) => !footer.includes(item));
  const isFull = capacity !== null && footer.length >= capacity;
  return {
    items: ordered,
    hidden,
    footer,
    more,
    capacity,
    isFull,
    hideFromFooter(key: string) {
      setHidden((previous) => [...new Set([...previous, key])]);
    },
    addToFooter(key: string) {
      if (isFull) return;
      const last = footer.at(-1)?.key;
      const rest = normalizedOrder.filter((id) => id !== key);
      const index = last === undefined ? 0 : rest.indexOf(last) + 1;
      setOrder([...rest.slice(0, index), key, ...rest.slice(index)]);
      setHidden((previous) => previous.filter((id) => id !== key));
    },
    setFooterShown(shown: boolean) {
      setHidden((previous) => {
        const keys = ordered.map((item) => item.key);
        const others = previous.filter((id) => !keys.includes(id));
        return shown ? others : [...others, ...keys];
      });
    },
    move(activeId: string, overId: string) {
      const zone =
        [footer, more].find((items) =>
          [activeId, overId].every((id) =>
            items.some((item) => item.key === id),
          ),
        ) ?? ordered;
      const next = reorderStoredOrder({
        activeId,
        overId,
        order: normalizedOrder,
        visibleIds: zone.map((item) => item.key),
      });
      if (next) setOrder(next);
    },
  };
}
