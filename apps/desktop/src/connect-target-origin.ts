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
