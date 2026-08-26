/**
 * Ordering logic for plugin panel rows in the sidebar.
 *
 * One persisted order covers every registered panel. The first five rows are
 * visible and the rest are an overflow; no panel has a separate hidden state.
 * Keys for temporarily unregistered panels remain in the persisted order so a
 * late or reinstalled frontend returns to the user's chosen position.
 */

export const PLUGIN_NAV_PANEL_VISIBLE_LIMIT = 5;

interface PluginNavPanelIdentity {
  pluginId: string;
  id: string;
}

export function getPluginNavPanelKey(panel: PluginNavPanelIdentity): string {
  return `${panel.pluginId}/${panel.id}`;
}

export function normalizePluginNavPanelOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const key of value) {
    if (typeof key !== "string" || key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

interface ArrangePluginNavPanelsArgs<TPanel extends PluginNavPanelIdentity> {
  panels: readonly TPanel[];
  storedOrder: readonly string[];
  activeKey?: string;
  visibleLimit?: number;
}

interface ArrangedPluginNavPanels<TPanel extends PluginNavPanelIdentity> {
  visible: TPanel[];
  overflow: TPanel[];
  ordered: TPanel[];
  normalizedOrder: string[];
}

export function arrangePluginNavPanels<TPanel extends PluginNavPanelIdentity>({
  panels,
  storedOrder,
  activeKey,
  visibleLimit: visibleLimitValue = PLUGIN_NAV_PANEL_VISIBLE_LIMIT,
}: ArrangePluginNavPanelsArgs<TPanel>): ArrangedPluginNavPanels<TPanel> {
  const byKey = new Map(
    panels.map((panel) => [getPluginNavPanelKey(panel), panel]),
  );
  const ordered: TPanel[] = [];
  const normalizedOrder = normalizePluginNavPanelOrder(storedOrder);
  const seen = new Set(normalizedOrder);

  for (const key of normalizedOrder) {
    const panel = byKey.get(key);
    if (panel) ordered.push(panel);
  }
  for (const panel of panels) {
    const key = getPluginNavPanelKey(panel);
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedOrder.push(key);
    ordered.push(panel);
  }

  const visibleLimit = Math.max(
    0,
    Math.min(PLUGIN_NAV_PANEL_VISIBLE_LIMIT, visibleLimitValue),
  );
  const visible = ordered.slice(0, visibleLimit);
  let overflow = ordered.slice(visibleLimit);
  const activeOverflowIndex =
    activeKey === undefined
      ? -1
      : overflow.findIndex(
          (panel) => getPluginNavPanelKey(panel) === activeKey,
        );
  if (activeOverflowIndex !== -1) {
    const active = overflow[activeOverflowIndex];
    const displaced = visible[visibleLimit - 1];
    if (active !== undefined && visibleLimit === 0) {
      visible.push(active);
      overflow = [
        ...overflow.slice(0, activeOverflowIndex),
        ...overflow.slice(activeOverflowIndex + 1),
      ];
    } else if (active !== undefined && displaced !== undefined) {
      visible[visibleLimit - 1] = active;
      overflow = [
        displaced,
        ...overflow.slice(0, activeOverflowIndex),
        ...overflow.slice(activeOverflowIndex + 1),
      ];
    }
  }

  return { visible, overflow, ordered, normalizedOrder };
}

interface ReorderPluginNavPanelsArgs {
  activeKey: string;
  overKey: string;
  order: readonly string[];
}

export function reorderPluginNavPanels({
  activeKey,
  overKey,
  order,
}: ReorderPluginNavPanelsArgs): string[] | null {
  const from = order.indexOf(activeKey);
  const to = order.indexOf(overKey);
  if (from === -1 || to === -1 || from === to) return null;

  const next = [...order];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return null;
  next.splice(to, 0, moved);
  return next;
}

function replaceRegisteredOrder(
  order: readonly string[],
  registeredKeys: readonly string[],
  nextRegisteredKeys: readonly string[],
): string[] {
  const registeredSet = new Set(registeredKeys);
  let cursor = 0;
  return order.map((key) =>
    registeredSet.has(key) ? (nextRegisteredKeys[cursor++] ?? key) : key,
  );
}

export function movePluginNavPanelToTop(
  order: readonly string[],
  registeredKeys: readonly string[],
  key: string,
): string[] | null {
  const from = registeredKeys.indexOf(key);
  if (from <= 0) return null;
  const nextRegisteredKeys = [...registeredKeys];
  nextRegisteredKeys.splice(from, 1);
  nextRegisteredKeys.unshift(key);
  return replaceRegisteredOrder(order, registeredKeys, nextRegisteredKeys);
}

export function movePluginNavPanelToOverflow(
  order: readonly string[],
  registeredKeys: readonly string[],
  key: string,
  visibleLimit = PLUGIN_NAV_PANEL_VISIBLE_LIMIT,
): string[] | null {
  const from = registeredKeys.indexOf(key);
  if (
    registeredKeys.length <= visibleLimit ||
    from < 0 ||
    from >= visibleLimit
  ) {
    return null;
  }

  const nextRegisteredKeys = [...registeredKeys];
  nextRegisteredKeys.splice(from, 1);
  nextRegisteredKeys.splice(visibleLimit, 0, key);
  return replaceRegisteredOrder(order, registeredKeys, nextRegisteredKeys);
}

export function havePluginNavPanelOrdersDiverged(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length !== right.length ||
    left.some((key, index) => key !== right[index])
  );
}
