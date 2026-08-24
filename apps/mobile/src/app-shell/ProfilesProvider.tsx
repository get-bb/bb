import {
  QueryClientProvider,
  focusManager,
  type QueryClient,
} from "@tanstack/react-query";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { ActiveProfileConnection } from "@/lib/connection";
import { getProfileStore, nativeAppState } from "@/lib/native";
import {
  useProfileStoreState,
  type NewServerProfile,
  type ProfileStoreStatus,
  type ServerProfile,
  type ServerProfilePatch,
} from "@/lib/profiles";
import { installAppStateQueryEvents } from "@/lib/query/app-state-query-events";
import { createProfileQueryClient } from "@/lib/query/query-client";
import type { ProfileClient } from "@/lib/sdk";
import { getAppProfileClientRegistry } from "./client-registry";
import { getActiveProfileConnector } from "./connector";

export interface ProfilesContextValue {
  status: ProfileStoreStatus;
  profiles: readonly ServerProfile[];
  activeProfile: ServerProfile | null;
  /** Non-null when a saved profile could not be read (it was skipped). */
  loadError: string | null;
  /** Live client/socket/session for `activeProfile`; null until activated. */
  connection: ActiveProfileConnection | null;
  addProfile(input: NewServerProfile): Promise<ServerProfile>;
  updateProfile(id: string, patch: ServerProfilePatch): Promise<ServerProfile>;
  removeProfile(id: string): Promise<void>;
  setActiveProfile(id: string): Promise<void>;
}

const ProfilesContext = createContext<ProfilesContextValue | null>(null);

// Keeps the React tree shape stable while no profile is active (first run,
// after removing the last server). Nothing queries through it: hooks that
// need a client go through `useProfileClient`, which requires a connection.
let placeholderQueryClient: QueryClient | null = null;
function getPlaceholderQueryClient(): QueryClient {
  placeholderQueryClient ??= createProfileQueryClient();
  return placeholderQueryClient;
}

/**
 * Owns the profile store, activates the selected profile (client + realtime
 * + connect session), and scopes TanStack Query to the active profile's
 * QueryClient. Mount once, inside the theme provider.
 */
export function ProfilesProvider({ children }: { children: ReactNode }) {
  const store = getProfileStore();
  const connector = getActiveProfileConnector();
  const storeState = useProfileStoreState(store);
  const connection = useSyncExternalStore(
    connector.subscribe,
    connector.getSnapshot,
    connector.getSnapshot,
  );

  const activeProfile = useMemo(
    () =>
      storeState.profiles.find((p) => p.id === storeState.activeProfileId) ??
      null,
    [storeState.profiles, storeState.activeProfileId],
  );

  useEffect(
    () =>
      installAppStateQueryEvents({ AppState: nativeAppState, focusManager }),
    [],
  );

  useEffect(() => {
    if (storeState.status !== "ready") return;
    connector.activate(activeProfile);
  }, [connector, storeState.status, activeProfile]);

  const value = useMemo<ProfilesContextValue>(
    () => ({
      status: storeState.status,
      profiles: storeState.profiles,
      activeProfile,
      loadError: storeState.loadError,
      connection,
      addProfile: (input) => store.addProfile(input),
      updateProfile: (id, patch) => store.updateProfile(id, patch),
      async removeProfile(id) {
        await store.removeProfile(id);
        getAppProfileClientRegistry().disposeClient(id);
      },
      setActiveProfile: (id) => store.setActiveProfile(id),
    }),
    [store, storeState, activeProfile, connection],
  );

  return (
    <ProfilesContext.Provider value={value}>
      <QueryClientProvider
        client={connection?.client.queryClient ?? getPlaceholderQueryClient()}
      >
        {children}
      </QueryClientProvider>
    </ProfilesContext.Provider>
  );
}

export function useProfiles(): ProfilesContextValue {
  const value = useContext(ProfilesContext);
  if (!value) {
    throw new Error("useProfiles must be used inside <ProfilesProvider>");
  }
  return value;
}

/** The active profile's SDK client. Only call under an active connection. */
export function useProfileClient(): ProfileClient {
  const { connection } = useProfiles();
  if (!connection) {
    throw new Error("useProfileClient requires an active server profile");
  }
  return connection.client;
}
