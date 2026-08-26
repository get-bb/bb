import { useCallback, useSyncExternalStore } from "react";
import { getShellPreferenceStore } from "./shell-preference-store";

/**
 * The WebView shell switch as React state plus its setter.
 *
 * It is client-local, not a server experiment: the shell is a rendering
 * choice for this device, and two phones on one server may disagree while it
 * is still being rolled out.
 */
export function useWebViewShellEnabled(): [boolean, (enabled: boolean) => void] {
  const store = getShellPreferenceStore();
  const enabled = useSyncExternalStore(
    store.subscribe,
    store.isEnabled,
    store.isEnabled,
  );
  const setEnabled = useCallback(
    (next: boolean) => store.setEnabled(next),
    [store],
  );
  return [enabled, setEnabled];
}
