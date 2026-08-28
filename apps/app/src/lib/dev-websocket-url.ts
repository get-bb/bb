interface BuildDevWebSocketUrlArgs {
  path: string;
}

function resolveBrowserHostDevWebSocketBaseUrl(
  serverPort: number,
  appPort: number,
): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";

  if (
    window.location.protocol === "https:" ||
    window.location.port !== String(appPort)
  ) {
    return `${protocol}//${window.location.host}/ws`;
  }

  return `${protocol}//${window.location.hostname}:${serverPort}/ws`;
}

function resolveDevWebSocketBaseUrl(): string | undefined {
  let serverPort: number | undefined;
  let appPort: number | undefined;
  try {
    serverPort = __BB_DEV_WS_BROWSER_HOST_PORT__;
    appPort = __BB_DEV_APP_BROWSER_HOST_PORT__;
  } catch {
    return undefined;
  }
  if (serverPort !== undefined && appPort !== undefined) {
    return resolveBrowserHostDevWebSocketBaseUrl(serverPort, appPort);
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
