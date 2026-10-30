import { createHash } from "node:crypto";
import type { BbDesktopServerChoice } from "@bb/desktop-contract";
import {
  BUILTIN_SERVER_NAME,
  type ConnectServerRef,
  type ServerTargetStore,
} from "./server-target.js";

export function customServerId(url: string): string {
  return `custom:${createHash("sha256").update(url).digest("hex")}`;
}

export function buildDesktopServerChoices(
  store: ServerTargetStore | null,
  connectServers: readonly ConnectServerRef[],
  builtinServerUrl: string,
): BbDesktopServerChoice[] {
  const target = store?.getTarget() ?? { kind: "builtin" };
  const customUrls = store?.getCustomServerUrls() ?? [];
  const showBuiltin =
    (store?.getShowBuiltinServer() ?? true) ||
    target.kind === "builtin" ||
    (connectServers.length === 0 && customUrls.length === 0);
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
    ...connectServers.map((server) => ({
      id: `connect:${server.handle}`,
      name:
        store?.getConnectServerName(server.handle) ?? new URL(server.url).host,
      origin: new URL(server.url).origin,
      kind: "account" as const,
      active:
        target.kind === "connect" && target.server.handle === server.handle,
    })),
    ...(store?.getCustomServers() ?? []).map(({ url, name }) => ({
      id: customServerId(url),
      name: name ?? new URL(url).host,
      origin: new URL(url).origin,
      kind: "custom" as const,
      active: target.kind === "custom" && target.url === url,
    })),
  ];
}
