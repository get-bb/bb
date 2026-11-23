import { createHash } from "node:crypto";
import { serverRouteKey } from "@bb/server-routes";
import type { BbDesktopServerChoice } from "@bb/desktop-contract";
import {
  BUILTIN_SERVER_NAME,
  connectHandleForRoute,
  routedServerRoutes,
  type ConnectServerRef,
  type RoutedServer,
  type ServerTargetStore,
} from "./server-target.js";

export function customServerId(url: string): string {
  return `custom:${createHash("sha256").update(url).digest("hex")}`;
}

export const ROUTED_SERVER_CHOICE_PREFIX = "server:";

export function routedServerChoiceId(serverId: string): string {
  return `${ROUTED_SERVER_CHOICE_PREFIX}${serverId}`;
}

export function routedServerName(server: RoutedServer): string {
  return server.name ?? new URL(server.addedUrl).host;
}

function routedConnectHandles(servers: readonly RoutedServer[]): Set<string> {
  return new Set(
    servers.flatMap((server) =>
      routedServerRoutes(server).flatMap(
        (route) => connectHandleForRoute(route) ?? [],
      ),
    ),
  );
}

export function buildDesktopServerChoices(
  store: ServerTargetStore | null,
  connectServers: readonly ConnectServerRef[],
  builtinServerUrl: string,
): BbDesktopServerChoice[] {
  const target = store?.getTarget() ?? { kind: "builtin" };
  const routedServers = store?.getRoutedServers() ?? [];
  const routedKeys = new Set(
    routedServers.flatMap((server) =>
      routedServerRoutes(server).map((route) => serverRouteKey(route.url)),
    ),
  );
  const customServers = (store?.getCustomServers() ?? []).filter(
    (server) => !routedKeys.has(serverRouteKey(server.url)),
  );
  const routedHandles = routedConnectHandles(routedServers);
  const accountServers = connectServers.filter(
    (server) => !routedHandles.has(server.handle),
  );
  const showBuiltin =
    (store?.getShowBuiltinServer() ?? true) ||
    target.kind === "builtin" ||
    (accountServers.length === 0 &&
      customServers.length === 0 &&
      routedServers.length === 0);
  return [
    ...(showBuiltin
      ? [
          {
            id: "builtin",
            name: BUILTIN_SERVER_NAME,
            origin: new URL(builtinServerUrl).origin,
            kind: "local" as const,
            active: target.kind === "builtin",
          },
        ]
      : []),
    ...routedServers.map((server) => ({
      id: routedServerChoiceId(server.serverId),
      name: routedServerName(server),
      origin: new URL(server.addedUrl).origin,
      kind: routedServerRoutes(server).some(
        (route) => connectHandleForRoute(route) !== null,
      )
        ? ("account" as const)
        : ("custom" as const),
      active:
        target.kind === "server" && target.server.serverId === server.serverId,
    })),
    ...accountServers.map((server) => ({
      id: `connect:${server.handle}`,
      name:
        store?.getConnectServerName(server.handle) ?? new URL(server.url).host,
      origin: new URL(server.url).origin,
      kind: "account" as const,
      active:
        target.kind === "connect" && target.server.handle === server.handle,
    })),
    ...customServers.map(({ url, name }) => ({
      id: customServerId(url),
      name: name ?? new URL(url).host,
      origin: new URL(url).origin,
      kind: "custom" as const,
      active: target.kind === "custom" && target.url === url,
    })),
  ];
}
