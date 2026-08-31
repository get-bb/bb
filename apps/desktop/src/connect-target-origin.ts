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

function matchesAnyOrigin(
  frameUrl: string,
  serverUrls: readonly string[],
): boolean {
  let frameOrigin: string;
  try {
    frameOrigin = new URL(frameUrl).origin;
  } catch {
    return false;
  }
  for (const serverUrl of serverUrls) {
    let serverOrigin: string;
    try {
      serverOrigin = new URL(serverUrl).origin;
    } catch {
      continue;
    }
    if (serverOrigin === frameOrigin) {
      return true;
    }
  }
  return false;
}

export function isBuiltinServerOrigin(
  frameUrl: string,
  localServerUrls: readonly string[],
): boolean {
  return matchesAnyOrigin(frameUrl, localServerUrls);
}
