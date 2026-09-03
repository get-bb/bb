import { arrangeByStoredOrder } from "@/lib/stored-order";

interface PluginNavPanelIdentity {
  pluginId: string;
  id: string;
}

export function getPluginNavPanelKey(panel: PluginNavPanelIdentity): string {
  return `${panel.pluginId}/${panel.id}`;
}

interface ArrangePluginNavPanelsArgs<TPanel extends PluginNavPanelIdentity> {
  panels: readonly TPanel[];
  storedOrder: readonly string[];
  hiddenKeys: readonly string[];
}

interface ArrangedPluginNavPanels<TPanel extends PluginNavPanelIdentity> {
  visible: TPanel[];
  hidden: TPanel[];
  normalizedOrder: string[];
}

export function arrangePluginNavPanels<TPanel extends PluginNavPanelIdentity>({
  panels,
  storedOrder,
  hiddenKeys,
}: ArrangePluginNavPanelsArgs<TPanel>): ArrangedPluginNavPanels<TPanel> {
  const { ordered, normalizedOrder } = arrangeByStoredOrder({
    items: panels,
    getId: getPluginNavPanelKey,
    storedOrder,
  });

  const hiddenSet = new Set(hiddenKeys);
  const visible: TPanel[] = [];
  const hidden: TPanel[] = [];
  for (const panel of ordered) {
    if (hiddenSet.has(getPluginNavPanelKey(panel))) hidden.push(panel);
    else visible.push(panel);
  }

  return { visible, hidden, normalizedOrder };
}

export function seedLeadingNavPanelKeys(
  order: readonly string[],
  leadingKeys: readonly string[],
): string[] {
  const next = [...order];
  if (next.length === 0) return next;
  const missing = leadingKeys.filter((key) => !next.includes(key));
  return missing.length === 0 ? next : [...missing, ...next];
}

export function hidePluginNavPanel(
  hiddenKeys: readonly string[],
  key: string,
): string[] {
  return hiddenKeys.includes(key) ? [...hiddenKeys] : [...hiddenKeys, key];
}

export function showPluginNavPanel(
  hiddenKeys: readonly string[],
  key: string,
): string[] {
  return hiddenKeys.filter((hiddenKey) => hiddenKey !== key);
}
