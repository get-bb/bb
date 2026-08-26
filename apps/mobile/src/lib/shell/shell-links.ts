import {
  isDeveloperRoutePath,
  matchProfileForWebLink,
  parseIncomingLink,
  type LinkProfileLike,
  type LinkResolution,
} from "../links/incoming-link";

/**
 * Deep-link resolution while the WebView shell is on.
 *
 * The page owns almost every surface, so a link resolves to one shell route
 * carrying a *web* path. Only the screens the shell keeps stay native: connect
 * enrolment, the server list, and the developer routes.
 */

/** The shell route. One screen, parameterised by profile and page path. */
export const SHELL_ROUTE_PATH = "/webview";

/**
 * Scheme paths that must not go to the page, because the shell owns them.
 *
 * `/settings/device` is the escape hatch: it holds the switch that turns the
 * shell off and the actions that recover a wedged page, so it can never be
 * something the page renders. Three entry points reach it — a row in the
 * page's Settings, the shell's load-failure screen, and the Home Screen quick
 * action — and only the first needs a working page.
 */
const NATIVE_ONLY_PREFIXES = [
  "/connect",
  "/settings/servers",
  "/settings/machines",
  "/settings/device",
] as const;

export function isNativeOnlyShellPath(path: string): boolean {
  const pathname = path.split("?", 1)[0] ?? "";
  return NATIVE_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export interface ShellHrefParams {
  /** Null keeps whichever profile is active. */
  profileId: string | null;
  /** A page path such as "/" or "/threads/thr_1?tab=diff". */
  path: string;
}

export function shellHref({ profileId, path }: ShellHrefParams): string {
  const params = new URLSearchParams();
  if (profileId !== null) params.set("profileId", profileId);
  if (path !== "/") params.set("path", path);
  const query = params.toString();
  return query.length > 0 ? `${SHELL_ROUTE_PATH}?${query}` : SHELL_ROUTE_PATH;
}

export interface ResolveShellLinkContext {
  profiles: readonly LinkProfileLike[];
  activeProfileId: string | null;
  developerRoutesEnabled: boolean;
}

/**
 * Map an incoming URL onto a shell navigation. Mirrors `resolveIncomingLink`
 * and returns the same shape, so `+native-intent.tsx` can pick a resolver and
 * treat the result identically.
 */
export function resolveShellIncomingLink(
  url: string,
  context: ResolveShellLinkContext,
): LinkResolution {
  const link = parseIncomingLink(url);
  switch (link.kind) {
    case "foreign":
      return { kind: "passthrough" };
    case "scheme": {
      if (isDeveloperRoutePath(link.path)) {
        // Dev builds keep their native diagnostic screens; a release bundle
        // has no such route, so send it home rather than to a blank page.
        return {
          kind: "navigate",
          path: context.developerRoutesEnabled ? link.path : "/",
          profileId: null,
        };
      }
      if (isNativeOnlyShellPath(link.path)) {
        return { kind: "navigate", path: link.path, profileId: null };
      }
      return {
        kind: "navigate",
        path: shellHref({ profileId: null, path: link.path }),
        profileId: null,
      };
    }
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
          path: shellHref({
            profileId: null,
            path: `${link.pathname}${link.search}`,
          }),
        };
      }
      const switching = match.profile.id !== context.activeProfileId;
      return {
        kind: "navigate",
        path: shellHref({
          // Name the profile explicitly when the link switches servers, so the
          // screen cannot render the previous profile for a frame.
          profileId: switching ? match.profile.id : null,
          path: `${match.pathname}${link.search}`,
        }),
        profileId: switching ? match.profile.id : null,
      };
    }
  }
}
