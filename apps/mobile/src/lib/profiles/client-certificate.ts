import type { ServerProfile } from "./profile";

export function clientCertificateOrigin(serverUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return `${url.hostname.toLowerCase()}:${url.port || "443"}`;
}

export function supportsClientCertificate(profile: ServerProfile): boolean {
  return (
    profile.mode === "direct" &&
    clientCertificateOrigin(profile.serverUrl) !== null
  );
}

export function shouldForgetClientCertificate(
  removed: ServerProfile,
  remaining: readonly ServerProfile[],
): boolean {
  const origin = clientCertificateOrigin(removed.serverUrl);
  if (origin === null) return false;
  return remaining.every(
    (profile) =>
      profile.id === removed.id ||
      clientCertificateOrigin(profile.serverUrl) !== origin,
  );
}
