import {
  isE2eModeEnabled,
  resetAppState,
  shouldResetOnLaunch,
  type E2eEnv,
} from "@/lib/e2e";
import { getProfileStore } from "@/lib/native";
import { getAppProfileClientRegistry } from "./client-registry";
import { getPreferencesStorage } from "./preferences-storage";

// `EXPO_PUBLIC_*` values are inlined by Metro at bundle time.
const env: E2eEnv = { EXPO_PUBLIC_BB_E2E: process.env.EXPO_PUBLIC_BB_E2E };

/** Dev builds and `EXPO_PUBLIC_BB_E2E=1` bundles expose the reset entry. */
export const e2eModeEnabled = isE2eModeEnabled(env, __DEV__);

/** Only `EXPO_PUBLIC_BB_E2E=1` bundles wipe state on every launch. */
export const resetOnLaunch = shouldResetOnLaunch(env);

/** Wipe profiles, live clients, and preferences (first-run state). */
export async function resetLocalState(): Promise<void> {
  await resetAppState({
    profileStore: getProfileStore(),
    preferences: getPreferencesStorage(),
    disposeClients: () => getAppProfileClientRegistry().disposeAll(),
  });
}
