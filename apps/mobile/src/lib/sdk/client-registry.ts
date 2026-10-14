import type { QueryClient } from "@tanstack/react-query";
import type { ServerProfile } from "../profiles/profile";
import { createProfileQueryClient } from "../query/query-client";
import {
  installRealtimeInvalidation,
  type RealtimeInvalidationHandle,
} from "../query/realtime-invalidation";
import {
  createMobileSdk,
  type CreateMobileSdkOptions,
  type MobileSdk,
} from "./create-mobile-sdk";
import type { ServerMovedResponse } from "./mobile-fetch";
import type { DeviceIdentity } from "@bb/sealed-channel";
import type { SealedServerTrust } from "../profiles/profile";
import {
  createMobileSealedTransport,
  type MobileSealedState,
  type MobileSealedTransport,
} from "../sealed/sealed-transport";

export type ProfileAuthFailure =
  | { source: "fetch"; status: number }
  | { source: "realtime"; message: string | null };

export interface ProfileClient extends MobileSdk {
  profileId: string;
  serverUrl: string;
  sealedServerKey: string | null;
  queryClient: QueryClient;
  onAuthFailure(listener: (failure: ProfileAuthFailure) => void): () => void;
  onSealedStateChange(listener: (state: MobileSealedState) => void): () => void;
  dispose(): void;
}

export interface ProfileClientSealedOptions {
  identity: () => Promise<DeviceIdentity>;
  deviceName: string;
  onPinned?: (
    profileId: string,
    trust: SealedServerTrust,
  ) => void | Promise<void>;
}

export interface CreateProfileClientRegistryOptions {
  onServerMoved?: (profileId: string, moved: ServerMovedResponse) => void;
  sdk?: Omit<CreateMobileSdkOptions, "onAuthFailure" | "onServerMoved">;
  sealed?: ProfileClientSealedOptions;
}

export interface ProfileClientRegistry {
  getClientForProfile(
    profile: Pick<ServerProfile, "id" | "serverUrl"> & {
      mode?: ServerProfile["mode"];
      sealed?: SealedServerTrust;
    },
  ): ProfileClient;
  disposeClient(profileId: string): void;
  disposeAll(): void;
}

export function createProfileClientRegistry(
  options: CreateProfileClientRegistryOptions = {},
): ProfileClientRegistry {
  const clients = new Map<string, ProfileClient>();

  function buildSealed(
    profile: Pick<ServerProfile, "id" | "serverUrl"> & {
      mode?: ServerProfile["mode"];
      sealed?: SealedServerTrust;
    },
    onStateChange: (state: MobileSealedState) => void,
  ): MobileSealedTransport | null {
    const sealed = options.sealed;
    if (sealed === undefined || profile.mode !== "connect") return null;
    const trust = profile.sealed ?? null;
    return createMobileSealedTransport({
      serverUrl: profile.serverUrl,
      identity: sealed.identity,
      deviceName: sealed.deviceName,
      trust,
      deviceCode: trust?.deviceCode ?? null,
      onPinned: (pinned) => sealed.onPinned?.(profile.id, pinned),
      onStateChange,
      ...(options.sdk?.fetch !== undefined
        ? { plaintextFetch: options.sdk.fetch, probeFetch: options.sdk.fetch }
        : {}),
      ...(options.sdk?.realtime?.socketFactory !== undefined
        ? { plaintextSocketFactory: options.sdk.realtime.socketFactory }
        : {}),
    });
  }

  function build(
    profile: Pick<ServerProfile, "id" | "serverUrl"> & {
      mode?: ServerProfile["mode"];
      sealed?: SealedServerTrust;
    },
  ): ProfileClient {
    const authFailureListeners = new Set<
      (failure: ProfileAuthFailure) => void
    >();
    const sealedListeners = new Set<(state: MobileSealedState) => void>();
    const emitAuthFailure = (failure: ProfileAuthFailure): void => {
      for (const listener of authFailureListeners) listener(failure);
    };
    const onServerMoved = options.onServerMoved;
    const sealedTransport = buildSealed(profile, (state) => {
      for (const listener of sealedListeners) listener(state);
    });
    const { sdk, realtime, fetch, sealed } = createMobileSdk(profile, {
      ...options.sdk,
      sealed: sealedTransport,
      onAuthFailure: (status) => {
        emitAuthFailure({ source: "fetch", status });
      },
      onServerMoved: onServerMoved
        ? (moved) => {
            onServerMoved(profile.id, moved);
          }
        : undefined,
    });
    const unsubscribeConnectFailed = realtime.onConnectFailed((event) => {
      if (event.authRejected) {
        emitAuthFailure({ source: "realtime", message: event.message });
      }
    });
    const queryClient = createProfileQueryClient();
    const invalidation: RealtimeInvalidationHandle =
      installRealtimeInvalidation(queryClient, realtime);
    return {
      profileId: profile.id,
      serverUrl: profile.serverUrl,
      sealedServerKey: profile.sealed?.serverKey ?? null,
      sdk,
      realtime,
      fetch,
      sealed,
      queryClient,
      onAuthFailure(listener) {
        authFailureListeners.add(listener);
        return () => {
          authFailureListeners.delete(listener);
        };
      },
      onSealedStateChange(listener) {
        sealedListeners.add(listener);
        return () => {
          sealedListeners.delete(listener);
        };
      },
      dispose() {
        unsubscribeConnectFailed();
        authFailureListeners.clear();
        sealedListeners.clear();
        invalidation.dispose();
        realtime.dispose();
        sealed?.dispose();
        queryClient.clear();
      },
    };
  }

  function disposeClient(profileId: string): void {
    const existing = clients.get(profileId);
    if (!existing) return;
    clients.delete(profileId);
    existing.dispose();
  }

  return {
    getClientForProfile(profile) {
      const existing = clients.get(profile.id);
      const sealedKey = profile.sealed?.serverKey ?? null;
      if (
        existing &&
        existing.serverUrl === profile.serverUrl &&
        (existing.sealedServerKey === sealedKey ||
          (existing.sealedServerKey === null && existing.sealed === null))
      ) {
        return existing;
      }
      if (existing) disposeClient(profile.id);
      const client = build(profile);
      clients.set(profile.id, client);
      return client;
    },
    disposeClient,
    disposeAll() {
      for (const id of Array.from(clients.keys())) disposeClient(id);
    },
  };
}
