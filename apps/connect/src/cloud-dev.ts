export const CLOUD_DEV_HOST_HEADER = "x-bb-cloud-dev-host";
export const SECURE_SESSION_COOKIE = "__Secure-better-auth.session_token";
export const LOCAL_SESSION_COOKIE = "better-auth.session_token";
export const SECURE_DESKTOP_SESSION_COOKIE =
  "__Secure-bb-connect.desktop_session";
export const LOCAL_DESKTOP_SESSION_COOKIE = "bb-connect.desktop_session";

export interface ConnectRuntime {
  accountAppUrl: string;
  baseDomain: string;
  localCloud: boolean;
  sessionCookieName: string;
  desktopSessionCookieName: string;
}

/** Resolve the small, fail-closed set of overrides used by local Cloud. */
export function resolveConnectRuntime(env: {
  ACCOUNT_APP_URL?: string;
  BASE_DOMAIN: string;
  CLOUD_DEV?: string;
}): ConnectRuntime {
  const accountAppUrl = new URL(
    env.ACCOUNT_APP_URL?.trim() || `https://${env.BASE_DOMAIN}`,
  );
  if (
    (accountAppUrl.protocol !== "http:" &&
      accountAppUrl.protocol !== "https:") ||
    accountAppUrl.username !== "" ||
    accountAppUrl.password !== "" ||
    accountAppUrl.pathname !== "/" ||
    accountAppUrl.search !== "" ||
    accountAppUrl.hash !== ""
  ) {
    throw new Error("ACCOUNT_APP_URL must be an HTTP(S) origin");
  }

  const cloudDevValue = env.CLOUD_DEV?.trim();
  if (cloudDevValue && cloudDevValue !== "true") {
    throw new Error("CLOUD_DEV must be true when set");
  }
  const localCloud = cloudDevValue === "true";
  if (localCloud) {
    const isLocalAccount =
      accountAppUrl.protocol === "http:" &&
      accountAppUrl.hostname === env.BASE_DOMAIN &&
      env.BASE_DOMAIN.endsWith(".localhost");
    if (!isLocalAccount) {
      throw new Error("CLOUD_DEV is only allowed for local Cloud development");
    }
  }

  return {
    accountAppUrl: accountAppUrl.origin,
    baseDomain: env.BASE_DOMAIN,
    localCloud,
    sessionCookieName: localCloud
      ? LOCAL_SESSION_COOKIE
      : SECURE_SESSION_COOKIE,
    desktopSessionCookieName: localCloud
      ? LOCAL_DESKTOP_SESSION_COOKIE
      : SECURE_DESKTOP_SESSION_COOKIE,
  };
}

/** Wrangler replaces wildcard hosts locally; the launcher preserves the label. */
export function resolveConnectRequestHost(
  headers: Headers,
  runtime: ConnectRuntime,
): string {
  const ordinaryHost = headers.get("host") ?? "";
  if (!runtime.localCloud) return ordinaryHost;
  const label = headers.get(CLOUD_DEV_HOST_HEADER)?.trim().toLowerCase();
  if (!label || label.includes(".") || !/^[a-z0-9-]+$/u.test(label)) {
    return ordinaryHost;
  }
  return `${label}.${runtime.baseDomain}`;
}

export function stripCloudDevHeader(headers: Headers): void {
  headers.delete(CLOUD_DEV_HOST_HEADER);
}

export async function waitForCloudService(args: {
  url: string;
  host: string;
  serviceExited: () => boolean;
  timeoutMs?: number;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const deadline = Date.now() + (args.timeoutMs ?? 30_000);
  const retryDelayMs = args.retryDelayMs ?? 250;
  const fetchImpl = args.fetchImpl ?? fetch;
  while (Date.now() < deadline) {
    if (args.serviceExited()) throw new Error("Cloud service exited early");
    try {
      const response = await fetchImpl(args.url, {
        headers: { host: args.host },
        signal: AbortSignal.timeout(1_000),
      });
      const ready = response.status < 500;
      await response.body?.cancel();
      if (ready) return;
    } catch {
      // Retry transport failures until the shared startup deadline.
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new Error(`timed out waiting for ${args.host}`);
}
