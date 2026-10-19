export const DEFAULT_CONNECT_BASE_URL = "https://getbb.app";

const STAGING_BASE_URL = "https://vibecodethis.site";

const DEV_BASE_URL_ERROR =
  "BB_DEV_CONNECT_BASE_URL must be an http://bb.localhost:<port> origin or https://vibecodethis.site";

export function resolveDefaultConnectBaseUrl(env: NodeJS.ProcessEnv): string {
  const configured = env.BB_DEV_CONNECT_BASE_URL?.trim();
  if (env.NODE_ENV !== "development" || !configured) {
    return DEFAULT_CONNECT_BASE_URL;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(DEV_BASE_URL_ERROR);
  }
  const bareOrigin =
    url.username.length === 0 &&
    url.password.length === 0 &&
    (url.pathname === "" || url.pathname === "/") &&
    url.search.length === 0 &&
    url.hash.length === 0;
  if (bareOrigin && url.origin === STAGING_BASE_URL) {
    return STAGING_BASE_URL;
  }
  if (
    !bareOrigin ||
    url.protocol !== "http:" ||
    url.hostname !== "bb.localhost" ||
    url.port.length === 0
  ) {
    throw new Error(DEV_BASE_URL_ERROR);
  }
  return url.origin;
}
