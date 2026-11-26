import type { ServerProfile } from "../profiles/profile";
import type { DeviceAccessStore } from "./device-access-store";
import type { DeviceCryptoDeps } from "./device-key";
import {
  createDirectDeviceAuth,
  type DirectDeviceAuth,
} from "./direct-device-auth";

export interface DeviceAuthRegistry {
  forProfile(profile: ServerProfile): Promise<DirectDeviceAuth | null>;
  forUrl(url: string): DirectDeviceAuth | null;
  sync(profiles: readonly ServerProfile[]): Promise<void>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  socketUrlResolver(url: string): Promise<string> | null;
}

export interface CreateDeviceAuthRegistryArgs {
  store: DeviceAccessStore;
  crypto: DeviceCryptoDeps;
  baseFetch: typeof fetch;
  now?: () => number;
}

function requestOrigin(input: RequestInfo | URL): string | null {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}

function httpOrigin(socketUrl: string): string | null {
  try {
    const url = new URL(socketUrl);
    if (url.protocol === "ws:") url.protocol = "http:";
    if (url.protocol === "wss:") url.protocol = "https:";
    return url.origin;
  } catch {
    return null;
  }
}

export function createDeviceAuthRegistry(
  args: CreateDeviceAuthRegistryArgs,
): DeviceAuthRegistry {
  const byProfile = new Map<string, DirectDeviceAuth>();

  const forOrigin = (origin: string | null): DirectDeviceAuth | null => {
    if (origin === null) return null;
    for (const auth of byProfile.values()) {
      if (auth.serverOrigin === origin) return auth;
    }
    return null;
  };

  const load = async (
    profile: ServerProfile,
  ): Promise<DirectDeviceAuth | null> => {
    if (profile.mode !== "direct" || profile.access === null) {
      byProfile.delete(profile.id);
      return null;
    }
    const existing = byProfile.get(profile.id);
    if (
      existing !== undefined &&
      existing.credentialId === profile.access.credentialId &&
      existing.serverOrigin === new URL(profile.serverUrl).origin
    ) {
      return existing;
    }
    const record = await args.store.read(profile.access.credentialId);
    if (
      record === null ||
      record.credentialId !== profile.access.credentialId
    ) {
      byProfile.delete(profile.id);
      return null;
    }
    const auth = createDirectDeviceAuth({
      profileId: profile.id,
      serverUrl: profile.serverUrl,
      record,
      store: args.store,
      crypto: args.crypto,
      baseFetch: args.baseFetch,
      ...(args.now === undefined ? {} : { now: args.now }),
    });
    byProfile.set(profile.id, auth);
    return auth;
  };

  return {
    forProfile: load,
    forUrl(url) {
      return forOrigin(requestOrigin(url));
    },
    async sync(profiles) {
      const ids = new Set(profiles.map((profile) => profile.id));
      const removed = [...byProfile.entries()].filter(([id]) => !ids.has(id));
      for (const [id] of removed) byProfile.delete(id);
      await Promise.all(
        removed.map(([, auth]) => args.store.remove(auth.credentialId)),
      );
      await Promise.all(profiles.map((profile) => load(profile)));
    },
    fetch(input, init) {
      const auth = forOrigin(requestOrigin(input));
      return auth === null
        ? args.baseFetch(input, init)
        : auth.fetch(input, init);
    },
    socketUrlResolver(url) {
      const auth = forOrigin(httpOrigin(url));
      return auth === null ? null : auth.websocketUrl(url);
    },
  };
}
