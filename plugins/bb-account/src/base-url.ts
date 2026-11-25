import { normalizeConnectOrigin } from "@bb/connect-client";

export { normalizeConnectOrigin as normalizeOrigin } from "@bb/connect-client";

export const DEFAULT_BASE_URL = "https://getbb.app";

const STAGING_BASE_URL = "https://vibecodethis.site";

const DEV_BASE_URL_ERROR =
  "BB_DEV_CONNECT_BASE_URL must be an http://bb.localhost:<port> origin or https://vibecodethis.site";

export function resolveDefaultBaseUrl(env: NodeJS.ProcessEnv): string {
  const configured = env.BB_DEV_CONNECT_BASE_URL?.trim();
  if (env.NODE_ENV !== "development" || !configured) {
    return DEFAULT_BASE_URL;
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

export type BaseUrlAllowed = (origin: string) => boolean;

export function isAllowedBaseUrl(
  origin: string,
  env: NodeJS.ProcessEnv,
): boolean {
  return createBaseUrlAllowed(env)(origin);
}

export function createBaseUrlAllowed(env: NodeJS.ProcessEnv): BaseUrlAllowed {
  const trusted = new Set([DEFAULT_BASE_URL, STAGING_BASE_URL]);
  const configured = env.BB_ACCOUNT_TRUSTED_ORIGINS;
  if (configured !== undefined) {
    for (const value of configured.split(",")) {
      let origin: string;
      try {
        origin = normalizeConnectOrigin(value.trim(), "origin");
        if (!origin.startsWith("https://")) throw new Error("https required");
      } catch {
        throw new Error(
          "BB_ACCOUNT_TRUSTED_ORIGINS must be a comma-separated list of HTTPS origins without credentials, paths, queries, fragments or wildcards",
        );
      }
      trusted.add(origin);
    }
  }
  const development = env.NODE_ENV === "development";
  return (origin) => {
    if (trusted.has(origin)) return true;
    if (!development) return false;
    try {
      const url = new URL(origin);
      return (
        url.origin === origin &&
        url.protocol === "http:" &&
        url.hostname === "bb.localhost" &&
        url.port.length > 0
      );
    } catch {
      return false;
    }
  };
}
