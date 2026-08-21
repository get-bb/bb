import type { ProfileStore } from "../profiles/profile-store";

/** The one env knob the e2e harness sets (`EXPO_PUBLIC_BB_E2E=1`). */
export interface E2eEnv {
  EXPO_PUBLIC_BB_E2E?: string;
}

/**
 * Whether e2e affordances (launch-time wipe, the reset deep link) are on.
 * Dev builds always accept the deep link so a developer can reset the
 * simulator; production builds need the explicit env at bundle time.
 */
export function isE2eModeEnabled(env: E2eEnv, isDevBuild: boolean): boolean {
  return env.EXPO_PUBLIC_BB_E2E === "1" || isDevBuild;
}

/** Launch-time wipe only when the env is set: dev builds must keep profiles. */
export function shouldResetOnLaunch(env: E2eEnv): boolean {
  return env.EXPO_PUBLIC_BB_E2E === "1";
}

/** The slice of MMKV (`bb.preferences`) the reset clears. */
export interface ClearableStorage {
  clearAll(): void;
}

export interface ResetAppStateDeps {
  profileStore: ProfileStore;
  preferences: ClearableStorage;
  /** Drop live SDK clients/caches for the wiped profiles (registry.disposeAll). */
  disposeClients?: () => void;
}

/**
 * Wipe every saved server profile (SecureStore) and the client-local
 * preferences (MMKV), leaving the app in its first-run state. Profiles are
 * removed one by one through the store so the index stays consistent and
 * subscribers (the profile provider) see the change.
 */
export async function resetAppState(deps: ResetAppStateDeps): Promise<void> {
  await deps.profileStore.load();
  for (const profile of deps.profileStore.listProfiles()) {
    await deps.profileStore.removeProfile(profile.id);
  }
  deps.disposeClients?.();
  deps.preferences.clearAll();
}
