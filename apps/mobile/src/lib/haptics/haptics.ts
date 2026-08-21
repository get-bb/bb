import * as Haptics from "expo-haptics";
import { useCallback, useSyncExternalStore } from "react";
import { createMMKV } from "react-native-mmkv";
import {
  createHapticsPreferenceStore,
  resolveHapticCall,
  type HapticCall,
  type HapticKind,
  type HapticsPreferenceStore,
} from "./haptics-policy";

let store: HapticsPreferenceStore | null = null;

/** App-wide haptics toggle (client-local, `bb.preferences` MMKV). */
function getHapticsPreferenceStore(): HapticsPreferenceStore {
  store ??= createHapticsPreferenceStore(createMMKV({ id: "bb.preferences" }));
  return store;
}

const IMPACT_STYLES = {
  light: Haptics.ImpactFeedbackStyle.Light,
  medium: Haptics.ImpactFeedbackStyle.Medium,
  heavy: Haptics.ImpactFeedbackStyle.Heavy,
} as const;

const NOTIFICATION_TYPES = {
  success: Haptics.NotificationFeedbackType.Success,
  warning: Haptics.NotificationFeedbackType.Warning,
  error: Haptics.NotificationFeedbackType.Error,
} as const;

async function performHapticCall(call: HapticCall): Promise<void> {
  switch (call.method) {
    case "selection":
      await Haptics.selectionAsync();
      return;
    case "impact":
      await Haptics.impactAsync(IMPACT_STYLES[call.style]);
      return;
    case "notification":
      await Haptics.notificationAsync(NOTIFICATION_TYPES[call.type]);
      return;
  }
}

/**
 * Fire haptic feedback for a semantic event, honoring the Settings toggle.
 * Best-effort and fire-and-forget: the simulator and unsupported hardware
 * reject, which is not an error the caller can act on.
 */
export function haptic(kind: HapticKind): void {
  const call = resolveHapticCall(getHapticsPreferenceStore().isEnabled(), kind);
  if (call === null) return;
  performHapticCall(call).catch(() => undefined);
}

/** The toggle as React state plus its setter (Settings → Haptics). */
export function useHapticsEnabled(): [boolean, (enabled: boolean) => void] {
  const preference = getHapticsPreferenceStore();
  const enabled = useSyncExternalStore(
    preference.subscribe,
    preference.isEnabled,
    preference.isEnabled,
  );
  const setEnabled = useCallback(
    (next: boolean) => {
      preference.setEnabled(next);
      // Confirm the change physically while the toggle is still under the
      // finger — only when turning on (off means off).
      if (next) haptic("impact-light");
    },
    [preference],
  );
  return [enabled, setEnabled];
}
