/**
 * Plugin flavor of the app's `lib/portal-scope.ts` (registry override —
 * component files are byte-identical between the app and the registry; only
 * this file differs). Everything a plugin renders is plugin-scoped, so the
 * scope attribute is unconditional: portaled overlay content (dialog,
 * select, popover, …) lands in document.body, outside the plugin's
 * `[data-bb-plugin-root]` mount, and must carry its own scope root for the
 * plugin's compiled stylesheet (`@scope ([data-bb-plugin-root])`) to reach
 * it. In the host app the same hook reads the plugin-slot context instead,
 * so host overlays stay out of plugin scopes. The portaled-overlay marker is
 * shared with the host copy and lets Electron route pointer input to visible
 * overlay controls instead of an underlying window-drag region.
 */
export function usePortalScopeProps(): {
  "data-bb-portaled-overlay": "";
  "data-bb-plugin-root"?: "";
} {
  return {
    "data-bb-portaled-overlay": "",
    "data-bb-plugin-root": "",
  };
}
