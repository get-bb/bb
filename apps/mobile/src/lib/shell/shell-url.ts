/**
 * URL work for the WebView shell, pure so it can be tested under node.
 *
 * A profile's `serverUrl` may carry a path prefix (a Tailscale Serve mount,
 * a reverse proxy under `/bb`), so a shell path is always relative to that
 * prefix and never to the origin.
 */

/** Strip a trailing slash so joins never produce `//`. */
function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/u, "");
}

export interface ServerOrigin {
  origin: string;
  /** "" for a server mounted at the root, otherwise "/prefix". */
  prefix: string;
}

/** Split a profile's `serverUrl`. Returns null when it will not parse. */
export function parseServerUrl(serverUrl: string): ServerOrigin | null {
  try {
    const url = new URL(serverUrl);
    return { origin: url.origin, prefix: trimTrailingSlash(url.pathname) };
  } catch {
    return null;
  }
}

/**
 * The absolute URL the WebView loads for a page path. `path` is what the page
 * router understands ("/", "/threads/thr_1?tab=diff"), not a mobile route.
 */
export function buildShellUrl(serverUrl: string, path: string): string {
  const parsed = parseServerUrl(serverUrl);
  const base = parsed
    ? `${parsed.origin}${parsed.prefix}`
    : trimTrailingSlash(serverUrl);
  if (path.length === 0 || path === "/") return `${base}/`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * Whether a navigation belongs to the page and should stay in the WebView.
 * Everything else — a documentation link, an OAuth provider, a mailto — goes
 * to the system browser, so the user never gets stranded in a chrome-less
 * WebView on a site the shell cannot navigate back from.
 */
export function isShellNavigation(url: string, serverUrl: string): boolean {
  const server = parseServerUrl(serverUrl);
  if (server === null) return false;
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    return false;
  }
  if (target.origin !== server.origin) return false;
  if (server.prefix.length === 0) return true;
  return (
    target.pathname === server.prefix ||
    target.pathname.startsWith(`${server.prefix}/`)
  );
}

/**
 * The page path inside a shell URL, for remembering where the user was.
 * Returns null when the URL does not belong to the profile.
 */
export function shellPathFromUrl(
  url: string,
  serverUrl: string,
): string | null {
  if (!isShellNavigation(url, serverUrl)) return null;
  const server = parseServerUrl(serverUrl);
  if (server === null) return null;
  const target = new URL(url);
  const pathname = target.pathname.slice(server.prefix.length) || "/";
  return `${pathname}${target.search}`;
}

/** `about:blank`, `data:`, and friends must never reach the system browser. */
export function isExternallyOpenable(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return (
      protocol === "http:" || protocol === "https:" || protocol === "mailto:"
    );
  } catch {
    return false;
  }
}
