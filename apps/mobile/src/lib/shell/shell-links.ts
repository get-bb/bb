import {
  isDeveloperRoutePath,
  matchProfileForWebLink,
  parseIncomingLink,
  pathMatchesPrefix,
  type LinkProfileLike,
  type LinkResolution,
} from "../links/incoming-link";

export const SHELL_ROUTE_PATH = "/webview";

const NATIVE_ONLY_PREFIXES = [
  "/connect",
  "/settings/servers",
  "/settings/machines",
  "/settings/device",
  "/settings/notifications",
] as const;

export function isNativeOnlyShellPath(path: string): boolean {
  return pathMatchesPrefix(path, NATIVE_ONLY_PREFIXES);
}

export interface ShellHrefParams {
  profileId: string | null;
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
          profileId: switching ? match.profile.id : null,
          path: `${match.pathname}${link.search}`,
        }),
        profileId: switching ? match.profile.id : null,
      };
    }
  }
}
