const CONNECT_APEX_HOSTNAME = "getbb.app";

export function isConnectServerUrl(serverUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") {
    return false;
  }
  const hostname = parsed.hostname.toLowerCase();
  return (
    hostname === CONNECT_APEX_HOSTNAME ||
    hostname.endsWith(`.${CONNECT_APEX_HOSTNAME}`)
  );
}

export function isTrustedSwitchOrigin(
  frameUrl: string,
  localServerUrls: readonly string[],
): boolean {
  let frameOrigin: string;
  try {
    frameOrigin = new URL(frameUrl).origin;
  } catch {
    return false;
  }
  for (const localServerUrl of localServerUrls) {
    let localOrigin: string;
    try {
      localOrigin = new URL(localServerUrl).origin;
    } catch {
      continue;
    }
    if (localOrigin === frameOrigin) {
      return true;
    }
  }
  return isConnectServerUrl(frameUrl);
}
