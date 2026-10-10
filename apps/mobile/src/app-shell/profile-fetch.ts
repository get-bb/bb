import { getProfileStore } from "@/lib/native";
import { createMobileFetch } from "@/lib/sdk/mobile-fetch";
import { getAppProfileClientRegistry } from "./client-registry";

const plainFetch = createMobileFetch((input, init) => fetch(input, init));

function normalizeServerUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname.replace(/\/+$/u, "")}`;
  } catch {
    return null;
  }
}

export function profileFetchForServer(serverUrl: string): typeof fetch {
  const wanted = normalizeServerUrl(serverUrl);
  if (wanted === null) return plainFetch;
  const profile = getProfileStore()
    .listProfiles()
    .find(
      (candidate) =>
        candidate.mode === "connect" &&
        normalizeServerUrl(candidate.serverUrl) === wanted,
    );
  if (profile !== undefined) {
    return getAppProfileClientRegistry().getClientForProfile(profile).fetch;
  }
  const direct = getProfileStore()
    .listProfiles()
    .find((candidate) => normalizeServerUrl(candidate.serverUrl) === wanted);
  if (direct !== undefined) return plainFetch;
  return async () => {
    throw new Error(
      `no saved server matches ${wanted}; refusing to send it a readable request`,
    );
  };
}
