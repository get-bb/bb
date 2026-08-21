/**
 * Incoming deep links: the `bb://` scheme, universal / app links
 * (`https://<handle>.getbb.app/threads/<id>`, any Direct server's URL), and
 * the Expo dev-client's own URLs. Pure: the app-shell (`+native-intent.tsx`)
 * feeds `redirectSystemPath` through `resolveIncomingLink` and acts on the
 * result (switch the active profile, navigate, or prompt to add the server).
 *
 * Web paths map onto the mobile routes where the app has the same surface
 * (mirrors @bb/client-core `route-paths.ts`); everything else falls back to
 * home so a link never strands the user on a "screen does not exist" page.
 */

const BB_URL_SCHEME = "bb";

export interface LinkProfileLike {
  id: string;
  serverUrl: string;
}

export type IncomingLink =
  /** `bb://<path>` — already an app path, routed as-is. */
  | { kind: "scheme"; path: string }
  /** `http(s)://host[:port]/<web path>` — a universal / app link or a pasted web URL. */
  | { kind: "web"; origin: string; pathname: string; search: string }
  /** Anything else (the dev-client's `exp+…://`, mailto, …): leave it alone. */
  | { kind: "foreign" };

export type LinkResolution =
  | { kind: "passthrough" }
  | {
      kind: "navigate";
      /** Mobile route path (with query string). */
      path: string;
      /** Profile to activate before navigating; null keeps the active one. */
      profileId: string | null;
    }
  | {
      /** A web link whose server is not saved on this phone. */
      kind: "unknown-server";
      serverUrl: string;
      /** Where to go once the server is added. */
      path: string;
    };

export interface ResolveIncomingLinkContext {
  profiles: readonly LinkProfileLike[];
  activeProfileId: string | null;
  /**
   * Whether this bundle exposes the developer-only route groups
   * (`app/dev/*`, `app/e2e/*`); dev builds and `EXPO_PUBLIC_BB_E2E=1` do.
   * Scheme links into them land on home otherwise.
   */
  developerRoutesEnabled: boolean;
}

/** The add-server route, prefilled with the linked server and a follow-up path. */
const ADD_SERVER_PATH = "/settings/servers/add";

/** Route groups that exist only in dev / e2e bundles (see app/e2e/reset.tsx). */
const DEVELOPER_ROUTE_PREFIXES = ["/dev", "/e2e"] as const;

/** `/dev/spike`, `/e2e/reset?x=1`, … — mobile paths under a developer-only group. */
export function isDeveloperRoutePath(path: string): boolean {
  const pathname = path.split("?", 1)[0] ?? "";
  return DEVELOPER_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

const SCHEME_URL_PATTERN = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/iu;

function splitPathAndSearch(rest: string): {
  pathname: string;
  search: string;
} {
  const withoutHash = rest.split("#", 1)[0] ?? "";
  const queryIndex = withoutHash.indexOf("?");
  const rawPath =
    queryIndex === -1 ? withoutHash : withoutHash.slice(0, queryIndex);
  const search = queryIndex === -1 ? "" : withoutHash.slice(queryIndex);
  const pathname = `/${rawPath.replace(/^\/+/u, "")}`;
  return {
    pathname: pathname.length > 1 ? pathname.replace(/\/+$/u, "") : "/",
    search,
  };
}

/** Classify a URL string. Never throws. */
export function parseIncomingLink(
  url: string,
  scheme: string = BB_URL_SCHEME,
): IncomingLink {
  const match = SCHEME_URL_PATTERN.exec(url.trim());
  if (!match) return { kind: "foreign" };
  const [, protocol, rest] = match;
  if (!protocol || rest === undefined) return { kind: "foreign" };
  if (protocol.toLowerCase() === scheme) {
    // `bb://threads/x?y=1` → `/threads/x?y=1`; `bb:///threads/x` too. The
    // "host" part of a custom-scheme URL is the first path segment.
    const { pathname, search } = splitPathAndSearch(rest);
    return { kind: "scheme", path: `${pathname}${search}` };
  }
  if (protocol === "http" || protocol === "https") {
    try {
      const parsed = new URL(url.trim());
      const pathname =
        parsed.pathname.length > 1 ? parsed.pathname.replace(/\/+$/u, "") : "/";
      return {
        kind: "web",
        origin: parsed.origin,
        pathname,
        search: parsed.search,
      };
    } catch {
      return { kind: "foreign" };
    }
  }
  return { kind: "foreign" };
}

function segments(pathname: string): string[] {
  return pathname.split("/").filter((segment) => segment.length > 0);
}

function withQuery(path: string, search: string): string {
  return search.length > 1 ? `${path}${search}` : path;
}

/**
 * The new-thread composer is the home screen's bottom dock: `/compose`
 * links (web or `bb://`) land on home with the `newThread` flag, which opens
 * the dock even without other params, plus the link's own query.
 */
function newThreadPath(search: string): string {
  return `/?newThread=1${search.length > 1 ? `&${search.slice(1)}` : ""}`;
}

const SCHEME_COMPOSE_PATH = /^\/compose\/?(\?.*)?$/u;

/** Scheme paths pass through as-is, except the retired `/compose` route. */
export function mapSchemePathToMobilePath(path: string): string {
  const match = SCHEME_COMPOSE_PATH.exec(path);
  return match ? newThreadPath(match[1] ?? "") : path;
}

/**
 * Map a web-app path (what `<handle>.getbb.app` serves) onto the mobile
 * route that shows the same thing. Unsupported web surfaces (extensions,
 * plugin panels, per-provider settings, …) land on home.
 */
export function mapWebPathToMobilePath(
  pathname: string,
  search: string = "",
): string {
  const parts = segments(pathname);
  const [first, second, third, fourth] = parts;
  if (parts.length === 0) return "/";
  switch (first) {
    case "threads":
      if (second && parts.length === 2) {
        return withQuery(`/threads/${second}`, search);
      }
      if (second === "search") return "/threads/search";
      return "/";
    case "projects":
      if (!second) return "/";
      if (parts.length === 2) {
        return `/?projectId=${encodeURIComponent(second)}`;
      }
      if (third === "threads" && fourth && parts.length === 4) {
        return withQuery(`/threads/${fourth}`, search);
      }
      if (third === "settings" && parts.length === 3) {
        return `/projects/${second}/settings`;
      }
      if (third === "archived" && parts.length === 3) {
        return `/settings/archived?projectId=${encodeURIComponent(second)}`;
      }
      return "/";
    case "archived":
      return "/settings/archived";
    case "settings":
      if (!second) return "/settings";
      if (
        (second === "servers" ||
          second === "archived" ||
          second === "server") &&
        parts.length === 2
      ) {
        return withQuery(`/settings/${second}`, search);
      }
      // Web-only settings sections (general, providers, machines, …) open the
      // mobile settings root; the specific section has no native screen.
      return "/settings";
    case "compose":
      return newThreadPath(search);
    default:
      return "/";
  }
}

interface ProfileMatch {
  profile: LinkProfileLike;
  /** The web path with the profile's path prefix (if any) removed. */
  pathname: string;
}

function profilePrefix(
  serverUrl: string,
): { origin: string; prefix: string } | null {
  try {
    const url = new URL(serverUrl);
    return { origin: url.origin, prefix: url.pathname.replace(/\/+$/u, "") };
  } catch {
    return null;
  }
}

/**
 * Find the saved profile a web link belongs to: same origin and, when the
 * profile sits under a path prefix, the link path inside it (longest prefix
 * wins).
 */
export function matchProfileForWebLink(
  profiles: readonly LinkProfileLike[],
  origin: string,
  pathname: string,
): ProfileMatch | null {
  let best: ProfileMatch | null = null;
  let bestPrefixLength = -1;
  for (const profile of profiles) {
    const parsed = profilePrefix(profile.serverUrl);
    if (!parsed || parsed.origin !== origin) continue;
    const { prefix } = parsed;
    const inside =
      prefix.length === 0 ||
      pathname === prefix ||
      pathname.startsWith(`${prefix}/`);
    if (!inside || prefix.length <= bestPrefixLength) continue;
    bestPrefixLength = prefix.length;
    const remainder = pathname.slice(prefix.length);
    best = { profile, pathname: remainder.length > 0 ? remainder : "/" };
  }
  return best;
}

/** `/settings/servers/add?serverUrl=…&next=…` */
export function addServerPathForLink(serverUrl: string, next: string): string {
  const params = new URLSearchParams();
  params.set("serverUrl", serverUrl);
  if (next !== "/") params.set("next", next);
  return `${ADD_SERVER_PATH}?${params.toString()}`;
}

/**
 * Decide what an incoming URL means for this phone. Scheme links route as
 * typed (developer-only paths land on home unless the bundle exposes them);
 * web links resolve to the profile that owns the origin (switching the
 * active profile when needed) or, for an unknown server, to the add-server
 * screen prefilled with the origin and the follow-up path.
 */
export function resolveIncomingLink(
  url: string,
  context: ResolveIncomingLinkContext,
): LinkResolution {
  const link = parseIncomingLink(url);
  switch (link.kind) {
    case "foreign":
      return { kind: "passthrough" };
    case "scheme":
      return {
        kind: "navigate",
        path:
          !context.developerRoutesEnabled && isDeveloperRoutePath(link.path)
            ? "/"
            : mapSchemePathToMobilePath(link.path),
        profileId: null,
      };
    case "web": {
      const match = matchProfileForWebLink(
        context.profiles,
        link.origin,
        link.pathname,
      );
      if (!match) {
        return {
          kind: "unknown-server",
          serverUrl: link.origin,
          path: mapWebPathToMobilePath(link.pathname, link.search),
        };
      }
      return {
        kind: "navigate",
        path: mapWebPathToMobilePath(match.pathname, link.search),
        profileId:
          match.profile.id === context.activeProfileId
            ? null
            : match.profile.id,
      };
    }
  }
}
