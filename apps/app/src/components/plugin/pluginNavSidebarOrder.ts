/**
 * Ordering and hide/show logic for the plugin panel rows in the sidebar.
 *
 * Panels arrive from the slot registry in a fixed registration order (plugin id
 * then declaration order). Users can drag them into their own order and hide
 * the ones they don't use; hidden panels are not removed, they move into the
 * sidebar's "More" disclosure. Both preferences persist client-side keyed by
 * `<pluginId>/<panelId>`, so an uninstalled-and-reinstalled plugin keeps its
 * place and a renamed panel id starts fresh at the end of the list.
 */

export interface PluginNavPanelIdentity {
  pluginId: string;
  id: string;
}

export function getPluginNavPanelKey(panel: PluginNavPanelIdentity): string {
  return `${panel.pluginId}/${panel.id}`;
}

interface ArrangePluginNavPanelsArgs<TPanel extends PluginNavPanelIdentity> {
  /** Registered panels, in registry order. */
  panels: readonly TPanel[];
  /** Persisted key order; may name panels that no longer exist. */
  storedOrder: readonly string[];
  /** Persisted hidden keys; may name panels that no longer exist. */
  hiddenKeys: readonly string[];
}

export interface ArrangedPluginNavPanels<
  TPanel extends PluginNavPanelIdentity,
> {
  /** Panels rendered in the sidebar proper, in user order. */
  visible: TPanel[];
  /** Panels parked in the "More" disclosure, in user order. */
  hidden: TPanel[];
  /**
   * `storedOrder` with duplicates dropped and never-ordered panels appended.
   * Callers persist this so newly installed panels get a slot.
   *
   * Keys of panels that are not registered right now keep their position. A
   * plugin frontend can register late — the sidebar mounts before every plugin
   * has loaded — so treating "absent" as "removed" would save a shortened order
   * during startup and lose the user's arrangement. Keeping the key also makes
   * an uninstalled-and-reinstalled plugin return to its old slot.
   */
  normalizedOrder: string[];
}

export function arrangePluginNavPanels<TPanel extends PluginNavPanelIdentity>({
  panels,
  storedOrder,
  hiddenKeys,
}: ArrangePluginNavPanelsArgs<TPanel>): ArrangedPluginNavPanels<TPanel> {
  const byKey = new Map(
    panels.map((panel) => [getPluginNavPanelKey(panel), panel]),
  );
  const ordered: TPanel[] = [];
  const normalizedOrder: string[] = [];
  const seen = new Set<string>();
  for (const key of storedOrder) {
    // Skip duplicates (corrupted storage). An unregistered key keeps its slot
    // in the order but contributes no row.
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedOrder.push(key);
    const panel = byKey.get(key);
    if (panel) ordered.push(panel);
  }
  // Panels the user has never ordered — newly installed plugins — land last, in
  // registry order, rather than jumping to the top of a customized list.
  for (const panel of panels) {
    const key = getPluginNavPanelKey(panel);
    if (seen.has(key)) continue;
    seen.add(key);
    normalizedOrder.push(key);
    ordered.push(panel);
  }

  const hiddenSet = new Set(hiddenKeys);
  const visible: TPanel[] = [];
  const hidden: TPanel[] = [];
  for (const panel of ordered) {
    if (hiddenSet.has(getPluginNavPanelKey(panel))) hidden.push(panel);
    else visible.push(panel);
  }

  return { visible, hidden, normalizedOrder };
}

interface ReorderPluginNavPanelsArgs {
  activeKey: string;
  overKey: string;
  /** Full persisted order, including hidden panels. */
  order: readonly string[];
  /** Keys currently rendered in the sidebar proper, in display order. */
  visibleKeys: readonly string[];
}

/**
 * Moves `activeKey` to `overKey`'s slot among the visible rows and folds the
 * result back into the full order. Hidden keys keep their index in the stored
 * list, so unhiding a panel restores it near where it used to sit instead of
 * appending it to the end.
 *
 * Returns `null` when the drag is a no-op.
 */
export function reorderPluginNavPanels({
  activeKey,
  overKey,
  order,
  visibleKeys,
}: ReorderPluginNavPanelsArgs): string[] | null {
  const from = visibleKeys.indexOf(activeKey);
  const to = visibleKeys.indexOf(overKey);
  if (from === -1 || to === -1 || from === to) return null;

  const nextVisible = [...visibleKeys];
  const [moved] = nextVisible.splice(from, 1);
  nextVisible.splice(to, 0, moved);

  const visibleSet = new Set(visibleKeys);
  let cursor = 0;
  return order.map((key) =>
    visibleSet.has(key) ? nextVisible[cursor++] : key,
  );
}

/**
 * Puts `leadingKeys` at the front of a customized order when it does not name
 * them yet. Rows that nobody has ordered normally land last, which is right for
 * a newly installed plugin but wrong for a built-in row that always sat above
 * the plugin rows. An empty order means "registry order" and stays empty.
 */
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

export function havePluginNavPanelOrdersDiverged(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length !== right.length ||
    left.some((key, index) => key !== right[index])
  );
}
