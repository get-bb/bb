interface BuildDevWebSocketUrlArgs {
  path: string;
}

function resolveBrowserHostDevWebSocketBaseUrl(port: number): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname}:${port}/ws`;
}

function resolveDevWebSocketBaseUrl(): string | undefined {
  if (typeof __BB_DEV_WS_URL__ === "string") {
    return __BB_DEV_WS_URL__;
  }

  if (typeof __BB_DEV_WS_BROWSER_HOST_PORT__ === "number") {
    return resolveBrowserHostDevWebSocketBaseUrl(
      __BB_DEV_WS_BROWSER_HOST_PORT__,
    );
  }

  return undefined;
}

export function buildDevWebSocketUrl(
  args: BuildDevWebSocketUrlArgs,
): string | undefined {
  const baseUrl = resolveDevWebSocketBaseUrl();
  if (baseUrl === undefined) {
    return undefined;
  }

  const url = new URL(baseUrl);
  url.pathname = args.path;
  url.search = "";
  url.hash = "";
  return url.toString();
}
